import type { Actor, ImportBatch, Network, NetworkTransaction } from "../entities.js";
import type { Deps, Page, PageQuery, Ports } from "../ports.js";
import { pageQuery } from "../ports.js";
import { notFound, ok, type Result } from "../result.js";
import { chooseActivation } from "../settlement/match.js";
import { parseNetworkFile, type ParsedTransaction, type RowError } from "../settlement/parse.js";
import { requireRole, writeAudit } from "./access.js";
import { settlementCreator, type ActivationForBooking } from "./settlement.js";

/*
 * The settlement pipeline, as the manager runs it: a network's export file in, a processed batch
 * out. Each row is parsed, its advertiser resolved to a merchant, deduplicated against what earlier
 * files brought, and then either inserted, matched to its click and booked, or applied as an update
 * to a transaction already known: a status change moves the cashback, an amount change re-books the
 * difference. Rows the pipeline cannot act on are written on the batch with their line number; the
 * whole file is one unit of work, so a crash leaves nothing half-booked and a `failed` batch row.
 */

export interface ImportInput {
  network: Network;
  filename: string;
  /** The file as text: the CSV or the JSON document. */
  content: string;
}

export function importUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const settlement = settlementCreator(deps);

  const importFile = async (actor: Actor, input: ImportInput): Promise<Result<ImportBatch>> => {
    const denied = requireRole<ImportBatch>(actor, "manager");
    if (denied) return denied;
    const parsed = parseNetworkFile(input.network, input.content);
    const unreadable = parsed.errors.some((e) => e.line === 0);
    const batch: ImportBatch = {
      id: ids.id("imp_"),
      network: input.network,
      filename: input.filename.trim() || `${input.network}-${clock.now().toISOString().slice(0, 10)}`,
      importedBy: actor.id,
      status: "received",
      rowCount: parsed.rowCount,
      newCount: 0,
      updatedCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      errorCount: parsed.errors.length,
      errors: parsed.errors,
      createdAt: clock.now(),
      processedAt: null,
    };
    // The batch row is written outside the transaction, so a failed run still leaves its trace.
    await ports.imports.insert(batch);
    if (unreadable) {
      const failed: ImportBatch = { ...batch, status: "failed", processedAt: clock.now() };
      await ports.imports.update(failed);
      return ok(failed);
    }
    const errors: RowError[] = [...parsed.errors];
    const counts = { newCount: 0, updatedCount: 0, matchedCount: 0 };
    try {
      await unitOfWork.run(async (tx) => {
        for (const row of parsed.rows) {
          const problem = await processRow(tx, batch, row, actor, counts);
          if (problem) errors.push({ line: row.line, message: problem });
        }
        const processed: ImportBatch = {
          ...batch,
          ...counts,
          unmatchedCount: counts.newCount - counts.matchedCount,
          status: "processed",
          errorCount: errors.length,
          errors: errors.sort((a, b) => a.line - b.line),
          processedAt: clock.now(),
        };
        await tx.imports.update(processed);
        await writeAudit(tx, ids, clock, { actor, action: "import.process", entityType: "import", entityId: batch.id, after: { rowCount: processed.rowCount, newCount: processed.newCount, updatedCount: processed.updatedCount, matchedCount: processed.matchedCount, unmatchedCount: processed.unmatchedCount, errorCount: processed.errorCount } });
        Object.assign(batch, processed);
      });
      return ok(batch);
    } catch (error) {
      const failed: ImportBatch = { ...batch, status: "failed", errors: [...parsed.errors, { line: 0, message: error instanceof Error ? error.message : String(error) }], errorCount: parsed.errors.length + 1, processedAt: clock.now() };
      await ports.imports.update(failed);
      return ok(failed);
    }
  };

  /** One row: insert and match, or update. Returns a message for the batch when the row could not be acted on. */
  async function processRow(tx: Ports, batch: ImportBatch, row: ParsedTransaction, actor: Actor, counts: { newCount: number; updatedCount: number; matchedCount: number }): Promise<string | null> {
    const merchant = await tx.merchants.findByAdvertiser(batch.network, row.advertiserRef);
    if (!merchant) return `advertiser ${row.advertiserRef} is not a merchant on ${batch.network}`;
    const existing = await tx.transactions.findByRef(batch.network, row.networkRef);
    if (existing) {
      counts.updatedCount++;
      return applyUpdate(tx, existing, row, actor, counts);
    }
    counts.newCount++;
    const transaction: NetworkTransaction = {
      id: ids.id("ntx_"),
      batchId: batch.id,
      network: batch.network,
      networkRef: row.networkRef,
      subId: row.subId,
      orderRef: row.orderRef,
      merchantId: merchant.id,
      orderedAt: row.orderedAt,
      orderCents: row.orderCents,
      commissionCents: row.commissionCents,
      networkStatus: row.status,
      reportedAt: row.reportedAt,
      matchStatus: "unmatched",
      activationId: null,
      ignoreReason: null,
    };
    await tx.transactions.insert(transaction);
    if (await tryMatch(tx, transaction, merchant.attributionDays, actor)) counts.matchedCount++;
    return null;
  }

  /** The automatic match: the click the subId names, if it qualifies. True when a cashback was booked. */
  async function tryMatch(tx: Ports, transaction: NetworkTransaction, attributionDays: number, actor: Actor): Promise<boolean> {
    const named = transaction.subId ? await tx.activations.findBySubId(transaction.subId) : null;
    const candidates: ActivationForBooking[] = named ? [named] : [];
    const outcome = chooseActivation({ merchantId: transaction.merchantId, attributionDays, subId: transaction.subId, orderedAt: transaction.orderedAt }, candidates);
    if (!outcome.matched) return false;
    const booked = await settlement.bookTransaction(tx, transaction, outcome.activation, actor);
    return booked.cashback !== null;
  }

  /** A reference already known: the network changed its mind about the status or the amount. */
  async function applyUpdate(tx: Ports, existing: NetworkTransaction, row: ParsedTransaction, actor: Actor, counts: { matchedCount: number }): Promise<string | null> {
    const updated: NetworkTransaction = { ...existing, subId: existing.subId ?? row.subId, orderRef: row.orderRef, orderedAt: row.orderedAt, orderCents: row.orderCents, commissionCents: row.commissionCents, networkStatus: row.status, reportedAt: row.reportedAt };
    await tx.transactions.update(updated);
    const cashback = await tx.cashbacks.findByTransaction(existing.id);
    if (!cashback) {
      // Unmatched so far; a click reference arriving late can still find its activation.
      if (updated.matchStatus === "unmatched" && updated.subId) {
        const merchant = await tx.merchants.findById(updated.merchantId);
        if (merchant && (await tryMatch(tx, updated, merchant.attributionDays, actor))) counts.matchedCount++;
      }
      return null;
    }
    if (cashback.decidedBy === "manager" || cashback.decidedBy === "claim") {
      const wants = row.status === "approved" ? "validated" : row.status === "declined" ? "refused" : null;
      if (wants && wants !== cashback.status) return `${row.networkRef} is ${row.status} by the network but cashback ${cashback.id} was decided by a ${cashback.decidedBy === "claim" ? "claim" : "manager"} (${cashback.status}); left as it is`;
      return null;
    }
    // The amount first, so a status change books the corrected figure.
    if (row.orderCents !== cashback.orderCents || row.commissionCents !== existing.commissionCents) {
      const activation = cashback.activationId ? await tx.activations.findById(cashback.activationId) : null;
      const offer = await tx.offers.findById(cashback.offerId);
      if (activation && offer) {
        const computation = await settlement.computeFor(tx, { ...activation, offer }, row.orderCents, row.commissionCents);
        if (computation.kind === "ignored") {
          // Nothing is owed any more: a pending cashback is refused, a validated one taken back.
          const to = cashback.status === "pending" ? "refused" : cashback.status === "validated" ? "cancelled" : null;
          if (to) {
            const moved = await settlement.changeStatus(tx, cashback, to, { decidedBy: "network", reason: computation.reason, actor, action: `cashback.${to === "refused" ? "refuse" : "cancel"}` });
            if (!moved.ok) return `${row.networkRef}: ${moved.error.message}`;
          }
          return null;
        }
        const adjusted = await settlement.adjustAmount(tx, cashback, row.orderCents, computation, actor);
        if (!adjusted.ok) return `${row.networkRef}: ${adjusted.error.message}`;
        Object.assign(cashback, adjusted.value);
      }
    }
    if (row.status === "approved" && (cashback.status === "refused" || cashback.status === "cancelled")) return `${row.networkRef} is approved by the network but cashback ${cashback.id} is ${cashback.status}, which is final; credit it through a claim if it is due`;
    const moved = await settlement.followNetwork(tx, cashback, row.status, actor);
    return moved.ok ? null : `${row.networkRef}: ${moved.error.message}`;
  }

  const listImports = async (actor: Actor, query: Partial<PageQuery>): Promise<Result<Page<ImportBatch>>> => {
    const denied = requireRole<Page<ImportBatch>>(actor, "manager");
    if (denied) return denied;
    return ok(await ports.imports.list(pageQuery(query)));
  };

  const getImport = async (actor: Actor, batchId: string): Promise<Result<ImportBatch>> => {
    const denied = requireRole<ImportBatch>(actor, "manager");
    if (denied) return denied;
    const batch = await ports.imports.findById(batchId);
    return batch ? ok(batch) : notFound("import");
  };

  return { importFile, listImports, getImport };
}
