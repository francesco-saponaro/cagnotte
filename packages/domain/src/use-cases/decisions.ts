import type { Actor, Cashback, CashbackStatus } from "../entities.js";
import { formatEuros } from "../money.js";
import type { Deps, Ports } from "../ports.js";
import { fail, notFound, ok, type Result } from "../result.js";
import { cashbackTransitions, move } from "../transitions.js";
import { requireRole, writeAudit } from "./access.js";
import { ledgerWriterCreator } from "./ledger.js";

/*
 * A manager deciding a cashback by hand, when the network is wrong or late. The ledger moves are
 * the same ones the settlement pipeline makes, so the wallet cannot tell who decided.
 */

export interface DecisionInput {
  reason: string;
}

export function decisionUseCasesCreator(deps: Deps) {
  const { unitOfWork, clock, ids } = deps;
  const ledger = ledgerWriterCreator(ids, clock);

  async function decide(actor: Actor, cashbackId: string, to: CashbackStatus, input: DecisionInput, action: string): Promise<Result<Cashback>> {
    const denied = requireRole<Cashback>(actor, "manager");
    if (denied) return denied;
    const reason = input.reason.trim();
    if (reason.length === 0) return fail("invalid", "reason is required");
    return unitOfWork.run(async (tx) => {
      const cashback = await tx.cashbacks.findById(cashbackId);
      if (!cashback) return notFound("cashback");
      const next = move(cashbackTransitions, "cashback", cashback.status, to);
      if (!next.ok) return next;
      const entries = await bookDecision(tx, ledger, actor, cashback, to);
      if (!entries.ok) return entries;
      const now = clock.now();
      const { offer: _offer, ...row } = cashback;
      const updated: Cashback = { ...row, status: to, decidedBy: "manager", decisionReason: reason, decidedAt: now, validatedAt: to === "validated" ? now : row.validatedAt };
      await tx.cashbacks.update(updated);
      await tx.ledger.insert(entries.value);
      await writeAudit(tx, ids, clock, { actor, action, entityType: "cashback", entityId: cashback.id, before: { status: cashback.status }, after: { status: to }, reason });
      return ok(updated);
    });
  }

  const validateCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "validated", input, "cashback.validate");
  const refuseCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "refused", input, "cashback.refuse");
  const cancelCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "cancelled", input, "cashback.cancel");

  return { validateCashback, refuseCashback, cancelCashback };
}

/** The ledger entries a status change books, given where the cashback's money is now. */
export async function bookDecision(ports: Ports, ledger: ReturnType<typeof ledgerWriterCreator>, actor: Actor | null, cashback: Cashback, to: CashbackStatus): Promise<Result<ReturnType<typeof ledger.transfer>>> {
  const base = { userId: cashback.userId, refType: "cashback" as const, refId: cashback.id, createdBy: actor?.id ?? null };
  const amount = cashback.amountCents;
  if (cashback.status === "pending" && to === "validated") return ok(ledger.transfer({ ...base, kind: "cashback_validated" }, "pending", "available", amount));
  if (cashback.status === "pending" && to === "refused") return ok(ledger.reverse({ ...base, kind: "cashback_refused" }, "pending", amount));
  if (cashback.status === "pending" && to === "cancelled") return ok(ledger.reverse({ ...base, kind: "cashback_cancelled" }, "pending", amount));
  if (cashback.status === "validated" && to === "cancelled") {
    // The money may already have left in a payout; a bucket never goes negative.
    const balances = await ports.ledger.balances(cashback.userId);
    if (balances.available < amount) return fail("rule", `only ${formatEuros(balances.available)} is still available; ${formatEuros(amount)} cannot be taken back`);
    return ok(ledger.reverse({ ...base, kind: "cashback_cancelled" }, "available", amount));
  }
  return fail("conflict", `a cashback cannot go from ${cashback.status} to ${to}`);
}
