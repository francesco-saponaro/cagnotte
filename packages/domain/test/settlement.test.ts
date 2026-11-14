import { describe, expect, it } from "vitest";
import type { Referral } from "../src/index.js";
import { AGENT, MANAGER, MEMBER, NOW, OTHER, activation, cashback, daysAgo, entry, errorOf, offer, unwrap, world } from "./harness.js";

/*
 * The settlement pipeline end to end on the in-memory world: a network file goes in, cashbacks and
 * ledger entries come out, and the second file about the same orders moves them on. The harness
 * world has `mer_a` on linkpool (advertiser `LP-mer_a`, 30-day window) with `ofr_live` at 6 %,
 * and `mer_b` on affinet with `ofr_fixed` at 10 €. Activations snapshot 500 bps unless told
 * otherwise, so 129,90 € earns 6,50 €.
 */

const HEADER = "transaction_id,advertiser_id,click_ref,order_ref,transaction_date,sale_amount,commission_amount,status,last_updated";

interface Row {
  ref: string;
  advertiser: string;
  click: string;
  order: string;
  at: Date;
  amount: string;
  commission: string;
  status: string;
  updated: Date;
}

/** The subId the harness gives an activation: its id padded to sixteen characters. */
const sub = (activationId: string) => activationId.padEnd(16, "0");

const row = (extra: Partial<Row> = {}): Row => ({ ref: "LP1", advertiser: "LP-mer_a", click: sub("act_1"), order: "ORD-1", at: daysAgo(5), amount: "129.90", commission: "15.59", status: "pending", updated: daysAgo(4), ...extra });
const csv = (rows: Partial<Row>[]) => [HEADER, ...rows.map(row).map((r) => [r.ref, r.advertiser, r.click, r.order, r.at.toISOString(), r.amount, r.commission, r.status, r.updated.toISOString()].join(","))].join("\n");
const file = (rows: Partial<Row>[], filename = "linkpool.csv") => ({ network: "linkpool" as const, filename, content: csv(rows) });

/** The member activated the live offer six days ago; the other member the fixed offer at the other merchant. */
const settled = (extra: Parameters<typeof world>[0] = {}) => world({ ...extra, activations: [activation("act_1", "usr_member", "ofr_live", daysAgo(6)), activation("act_2", "usr_other", "ofr_fixed", daysAgo(6)), ...(extra.activations ?? [])] });

const entriesOf = async (w: ReturnType<typeof world>, cashbackId: string) => (await w.ports.ledger.listByRef("cashback", cashbackId)).map((e) => [e.kind, e.bucket, e.amountCents]);

describe("importFile", () => {
  it("reads a file, matches the click, books a pending cashback and writes the batch summary", async () => {
    const w = settled();
    const batch = unwrap(await w.importFile(MANAGER, file([{}])));
    expect(batch).toMatchObject({ network: "linkpool", filename: "linkpool.csv", importedBy: "usr_manager", status: "processed", rowCount: 1, newCount: 1, updatedCount: 0, matchedCount: 1, unmatchedCount: 0, errorCount: 0, errors: [], createdAt: NOW, processedAt: NOW });
    const tx = (await w.ports.transactions.list({ page: 1, pageSize: 10 })).items[0]!;
    expect(tx).toMatchObject({ batchId: batch.id, network: "linkpool", networkRef: "LP1", subId: sub("act_1"), orderRef: "ORD-1", merchantId: "mer_a", orderCents: 12990, commissionCents: 1559, networkStatus: "pending", matchStatus: "matched", activationId: "act_1", ignoreReason: null });
    const cb = (await w.ports.cashbacks.findByTransaction(tx.id))!;
    expect(cb).toMatchObject({ userId: "usr_member", offerId: "ofr_live", activationId: "act_1", orderCents: 12990, rateBps: 500, amountCents: 650, marginClamped: false, status: "pending", decidedBy: null, expectedValidationAt: new Date(daysAgo(5).getTime() + 30 * 24 * 60 * 60 * 1000), validatedAt: null });
    expect(await entriesOf(w, cb.id)).toEqual([["cashback_pending", "pending", 650]]);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 650, available: 0, reserved: 0, paid: 0 });
    const audit = unwrap(await w.listAudit(MANAGER, { entityType: "import" }));
    expect(audit.items.map((a) => a.action)).toEqual(["import.process"]);
    expect(unwrap(await w.listAudit(MANAGER, { entityId: cb.id })).items.map((a) => a.action)).toEqual(["cashback.create"]);
  });

  it("validates at once what the network has already approved, and refuses what it declined", async () => {
    const w = settled({ activations: [activation("act_3", "usr_member", "ofr_live", daysAgo(10))] });
    unwrap(await w.importFile(MANAGER, file([{ status: "approved" }, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "declined", amount: "50.00", commission: "3.00" }])));
    const [declined, approved] = (await w.ports.cashbacks.list({ userId: "usr_member", page: 1, pageSize: 10 })).items.sort((a, b) => a.amountCents - b.amountCents);
    expect(approved).toMatchObject({ amountCents: 650, status: "validated", decidedBy: "network", validatedAt: NOW, decidedAt: NOW });
    expect(await entriesOf(w, approved!.id)).toEqual([
      ["cashback_pending", "pending", 650],
      ["cashback_validated", "pending", -650],
      ["cashback_validated", "available", 650],
    ]);
    expect(declined).toMatchObject({ amountCents: 250, status: "refused", decidedBy: "network", decisionReason: "declined_by_network" });
    expect(await entriesOf(w, declined!.id)).toEqual([
      ["cashback_pending", "pending", 250],
      ["cashback_refused", "pending", -250],
    ]);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 650, reserved: 0, paid: 0 });
  });

  it("cuts the cashback to the commission and says so", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{ commission: "3.00" }])));
    const cb = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items[0]!;
    expect(cb).toMatchObject({ amountCents: 300, marginClamped: true });
  });

  it("leaves a transaction unmatched when nothing names a click, and counts it", async () => {
    const w = settled();
    const batch = unwrap(
      await w.importFile(
        MANAGER,
        file([
          { ref: "LP1", click: "", order: "ORD-NOCLICK" },
          { ref: "LP2", click: "zzzzzzzzzzzzzzzz", order: "ORD-UNKNOWN" },
          { ref: "LP3", click: sub("act_2"), order: "ORD-OTHER-MERCHANT" },
          { ref: "LP4", click: sub("act_1"), order: "ORD-BEFORE-CLICK", at: daysAgo(7) },
          { ref: "LP5", click: sub("act_1"), order: "ORD-LATE", at: daysAgo(-40), updated: daysAgo(-40) },
        ]),
      ),
    );
    expect(batch).toMatchObject({ rowCount: 5, newCount: 5, matchedCount: 0, unmatchedCount: 5, errorCount: 0 });
    const list = await w.ports.transactions.list({ matchStatus: "unmatched", page: 1, pageSize: 10 });
    expect(list.total).toBe(5);
    expect(list.items.every((t) => t.activationId === null)).toBe(true);
    expect(await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).toMatchObject({ total: 0 });
  });

  it("attributes one order per click: a second order on the same click waits for a claim", async () => {
    const w = settled();
    const batch = unwrap(await w.importFile(MANAGER, file([{}, { ref: "LP2", order: "ORD-SECOND", amount: "40.00", commission: "2.40" }])));
    expect(batch).toMatchObject({ newCount: 2, matchedCount: 1, unmatchedCount: 1 });
    const second = (await w.ports.transactions.list({ matchStatus: "unmatched", page: 1, pageSize: 10 })).items[0]!;
    expect(second.orderRef).toBe("ORD-SECOND");
    expect(unwrap(await w.getTransaction(MANAGER, second.id)).noMatchReason).toBe("click_already_used");
    expect((await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).total).toBe(1);
  });

  it("ignores a matched order the offer's rules exclude, keeping the click it came from", async () => {
    const w = settled({
      offers: [offer("ofr_min", "mer_a", { minSpendCents: 20000 }), offer("ofr_new", "mer_a", { newCustomersOnly: true })],
      activations: [activation("act_min", "usr_member", "ofr_min", daysAgo(6)), activation("act_new", "usr_member", "ofr_new", daysAgo(6)), activation("act_zero", "usr_member", "ofr_live", daysAgo(6))],
      cashbacks: [cashback("cb_old", "usr_member", "ofr_live", { status: "validated", validatedAt: daysAgo(30) })],
    });
    const batch = unwrap(
      await w.importFile(
        MANAGER,
        file([
          { ref: "LP1", click: sub("act_min"), order: "ORD-MIN" },
          { ref: "LP2", click: sub("act_new"), order: "ORD-NEW" },
          { ref: "LP3", click: sub("act_zero"), order: "ORD-ZERO", commission: "0.00" },
        ]),
      ),
    );
    expect(batch).toMatchObject({ matchedCount: 0, unmatchedCount: 3 });
    const ignored = (await w.ports.transactions.list({ matchStatus: "ignored", page: 1, pageSize: 10 })).items;
    expect(ignored.map((t) => [t.orderRef, t.ignoreReason, t.activationId])).toEqual([
      ["ORD-ZERO", "no_commission", "act_zero"],
      ["ORD-NEW", "not_new_customer", "act_new"],
      ["ORD-MIN", "below_minimum", "act_min"],
    ]);
    expect((await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).total).toBe(1);
  });

  it("reports the rows it cannot use, line by line, and processes the rest", async () => {
    const w = settled();
    const content = csv([{}, { ref: "LP2", advertiser: "LP-nobody", order: "ORD-2" }, { ref: "LP3", amount: "12.9O", order: "ORD-3" }, { ref: "LP1", order: "ORD-DUP" }]);
    const batch = unwrap(await w.importFile(MANAGER, { network: "linkpool", filename: "x.csv", content }));
    expect(batch).toMatchObject({ status: "processed", rowCount: 4, newCount: 1, matchedCount: 1, errorCount: 3 });
    expect(batch.errors).toEqual([
      { line: 3, message: "advertiser LP-nobody is not a merchant on linkpool" },
      { line: 4, message: "sale_amount is not an amount: 12.9O" },
      { line: 5, message: "LP1 appears twice in the file (first on line 2); the second row is ignored" },
    ]);
    expect((await w.ports.transactions.list({ page: 1, pageSize: 10 })).total).toBe(1);
  });

  it("marks a file it cannot read as failed, with the batch kept for the record", async () => {
    const w = settled();
    const batch = unwrap(await w.importFile(MANAGER, { network: "affinet", filename: "broken.json", content: "{ not json" }));
    expect(batch).toMatchObject({ status: "failed", rowCount: 0, errorCount: 1, errors: [{ line: 0, message: "the file is not valid JSON" }] });
    expect((await w.ports.imports.list({ page: 1, pageSize: 10 })).total).toBe(1);
  });

  it("is for managers only", async () => {
    const w = settled();
    expect(errorOf(await w.importFile(AGENT, file([{}]))).code).toBe("forbidden");
    expect(errorOf(await w.listImports(AGENT, {})).code).toBe("forbidden");
  });
});

describe("a second file about the same orders", () => {
  it("updates a known reference instead of inserting it, and validates the cashback when the network approves", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{}])));
    w.setNow(daysAgo(-1));
    const second = unwrap(await w.importFile(MANAGER, file([{ status: "approved", updated: daysAgo(-1) }], "linkpool-2.csv")));
    expect(second).toMatchObject({ rowCount: 1, newCount: 0, updatedCount: 1, matchedCount: 0, unmatchedCount: 0 });
    const list = await w.ports.transactions.list({ page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ networkStatus: "approved", reportedAt: daysAgo(-1) });
    const cb = (await w.ports.cashbacks.findByTransaction(list.items[0]!.id))!;
    expect(cb).toMatchObject({ status: "validated", decidedBy: "network", validatedAt: daysAgo(-1) });
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 650, reserved: 0, paid: 0 });
    expect(unwrap(await w.listAudit(MANAGER, { entityId: cb.id })).items.map((a) => a.action)).toEqual(["cashback.validate", "cashback.create"]);
  });

  it("refuses a pending cashback the network declines, and takes back a validated one it later declines", async () => {
    const w = settled({ activations: [activation("act_3", "usr_member", "ofr_live", daysAgo(10))] });
    unwrap(await w.importFile(MANAGER, file([{}, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "approved" }])));
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 650, available: 650, reserved: 0, paid: 0 });
    unwrap(await w.importFile(MANAGER, file([{ status: "declined" }, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "declined" }])));
    const statuses = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items.map((c) => c.status).sort();
    expect(statuses).toEqual(["cancelled", "refused"]);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 0, reserved: 0, paid: 0 });
  });

  it("books the difference when the network changes the amount of a pending or a validated order", async () => {
    const w = settled({ activations: [activation("act_3", "usr_member", "ofr_live", daysAgo(10))] });
    unwrap(await w.importFile(MANAGER, file([{}, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "approved" }])));
    unwrap(await w.importFile(MANAGER, file([{ amount: "100.00" }, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "approved", amount: "200.00", commission: "20.00" }])));
    const [pending, validated] = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items.sort((a, b) => a.amountCents - b.amountCents);
    expect(pending).toMatchObject({ status: "pending", orderCents: 10000, amountCents: 500 });
    expect(await entriesOf(w, pending!.id)).toEqual([
      ["cashback_pending", "pending", 650],
      ["cashback_adjusted", "pending", -150],
    ]);
    expect(validated).toMatchObject({ status: "validated", orderCents: 20000, amountCents: 1000 });
    expect((await entriesOf(w, validated!.id)).at(-1)).toEqual(["cashback_adjusted", "available", 350]);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 500, available: 1000, reserved: 0, paid: 0 });
  });

  it("will not take back what the member has already withdrawn, and says so in the batch", async () => {
    const w = settled({ ledgerEntries: [entry("led_seed", "usr_member", "available", 2000)] });
    unwrap(await w.importFile(MANAGER, file([{ status: "approved" }])));
    unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2500, destination: "FR76 •••• 1234" }));
    const batch = unwrap(await w.importFile(MANAGER, file([{ status: "declined" }])));
    expect(batch.errorCount).toBe(1);
    expect(batch.errors[0]?.message).toMatch(/only 1,50 € is still available/);
    const cb = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items[0]!;
    expect(cb.status).toBe("validated");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 150, reserved: 2500, paid: 0 });
  });

  it("leaves a cashback a manager decided alone, and notes it", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{}])));
    const cb = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items[0]!;
    unwrap(await w.validateCashback(MANAGER, cb.id, { reason: "proof received" }));
    const batch = unwrap(await w.importFile(MANAGER, file([{ status: "declined" }])));
    expect(batch.errors).toEqual([{ line: 2, message: `LP1 is declined by the network but cashback ${cb.id} was decided by a manager (validated); left as it is` }]);
    expect((await w.ports.cashbacks.findById(cb.id))?.status).toBe("validated");
  });

  it("cannot revive a refused cashback the network re-approves, and says so", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{ status: "declined" }])));
    const batch = unwrap(await w.importFile(MANAGER, file([{ status: "approved" }])));
    expect(batch.errors[0]?.message).toMatch(/refused, which is final/);
  });

  it("matches a transaction that arrives without a click and gets one in a later file", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{ click: "" }])));
    const second = unwrap(await w.importFile(MANAGER, file([{}])));
    expect(second).toMatchObject({ updatedCount: 1, matchedCount: 1 });
    expect((await w.ports.transactions.list({ page: 1, pageSize: 10 })).items[0]).toMatchObject({ matchStatus: "matched", activationId: "act_1" });
  });
});

describe("the transactions queue", () => {
  async function queued() {
    const w = settled({ activations: [activation("act_3", "usr_other", "ofr_live", daysAgo(8)), activation("act_4", "usr_member", "ofr_paused", daysAgo(5.5))] });
    unwrap(await w.importFile(MANAGER, file([{ click: "", order: "ORD-NOCLICK" }, { ref: "LP2", order: "ORD-MATCHED" }, { ref: "LP3", click: "", order: "ORD-TWO", advertiser: "LP-mer_a" }])));
    const items = (await w.ports.transactions.list({ page: 1, pageSize: 10 })).items;
    const byOrder = (order: string) => items.find((t) => t.orderRef === order)!;
    return { w, unmatched: byOrder("ORD-NOCLICK"), matched: byOrder("ORD-MATCHED"), second: byOrder("ORD-TWO") };
  }

  it("lists with filters and shows a transaction with its merchant, click, cashback and the proposals", async () => {
    const { w, unmatched, matched } = await queued();
    expect(unwrap(await w.listTransactions(MANAGER, { match: "unmatched" })).total).toBe(2);
    expect(unwrap(await w.listTransactions(MANAGER, { merchant: "mer_b" })).total).toBe(0);
    const detail = unwrap(await w.getTransaction(MANAGER, unmatched.id));
    expect(detail.merchant.name).toBe("Shop mer_a");
    expect(detail.activation).toBeNull();
    expect(detail.cashback).toBeNull();
    expect(detail.noMatchReason).toBe("no_sub_id");
    expect(detail.candidates.map((a) => [a.id, a.member.email])).toEqual([
      ["act_4", "member@example.com"],
      ["act_1", "member@example.com"],
      ["act_3", "other@example.com"],
    ]);
    const matchedDetail = unwrap(await w.getTransaction(MANAGER, matched.id));
    expect(matchedDetail.activation?.id).toBe("act_1");
    expect(matchedDetail.cashback?.amountCents).toBe(650);
    expect(matchedDetail.candidates).toEqual([]);
    expect(errorOf(await w.getTransaction(AGENT, matched.id)).code).toBe("forbidden");
    expect(errorOf(await w.getTransaction(MANAGER, "ntx_nope")).code).toBe("not_found");
  });

  it("matches by hand to a proposed click, booking the cashback like the pipeline", async () => {
    const { w, unmatched } = await queued();
    const tx = unwrap(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_3" }));
    expect(tx).toMatchObject({ matchStatus: "matched", activationId: "act_3" });
    const cb = (await w.ports.cashbacks.findByTransaction(tx.id))!;
    expect(cb).toMatchObject({ userId: "usr_other", amountCents: 650, status: "pending" });
    expect(unwrap(await w.listAudit(MANAGER, { entityId: tx.id })).items.map((a) => a.action)).toEqual(["transaction.match"]);
  });

  it("refuses a click that does not qualify, one that already has a cashback, and a transaction already matched", async () => {
    const { w, unmatched, matched, second } = await queued();
    expect(errorOf(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_2" })).message).toMatch(/other merchant/);
    expect(errorOf(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_1" })).code).toBe("conflict");
    expect(errorOf(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_nope" })).code).toBe("not_found");
    expect(errorOf(await w.matchTransaction(MANAGER, matched.id, { activationId: "act_3" })).code).toBe("conflict");
    unwrap(await w.matchTransaction(MANAGER, second.id, { activationId: "act_3" }));
    expect(errorOf(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_3" })).code).toBe("conflict");
    expect(errorOf(await w.matchTransaction(AGENT, unmatched.id, { activationId: "act_3" })).code).toBe("forbidden");
  });

  it("ignores with a reason, and can still match an ignored one later", async () => {
    const { w, unmatched, matched } = await queued();
    const ignored = unwrap(await w.ignoreTransaction(MANAGER, unmatched.id, { reason: "duplicate of ORD-MATCHED" }));
    expect(ignored).toMatchObject({ matchStatus: "ignored", ignoreReason: "duplicate of ORD-MATCHED" });
    expect(errorOf(await w.ignoreTransaction(MANAGER, matched.id, { reason: "x" })).code).toBe("conflict");
    expect(errorOf(await w.ignoreTransaction(MANAGER, unmatched.id, { reason: " " })).code).toBe("invalid");
    expect(unwrap(await w.matchTransaction(MANAGER, unmatched.id, { activationId: "act_3" })).matchStatus).toBe("matched");
    expect(unwrap(await w.listAudit(MANAGER, { entityId: unmatched.id })).items.map((a) => a.action)).toEqual(["transaction.match", "transaction.ignore"]);
  });

  it("lists and shows import batches", async () => {
    const { w } = await queued();
    const page = unwrap(await w.listImports(MANAGER, {}));
    expect(page.total).toBe(1);
    expect(unwrap(await w.getImport(MANAGER, page.items[0]!.id)).rowCount).toBe(3);
    expect(errorOf(await w.getImport(MANAGER, "imp_nope")).code).toBe("not_found");
  });
});

describe("creditClaim", () => {
  const claimInput = { offerId: "ofr_live", orderRef: "ORD-CLAIM", orderedAt: daysAgo(5), orderCents: 7990, proofText: "Order confirmation ORD-CLAIM" };

  async function raised(extra: Parameters<typeof world>[0] = {}) {
    const w = settled(extra);
    const claim = unwrap(await w.fileClaim(MEMBER, claimInput));
    unwrap(await w.acknowledgeClaim(AGENT, claim.id));
    return { w, claim };
  }

  it("creates a validated cashback from the claim's click and credits the member at once", async () => {
    const { w, claim } = await raised();
    unwrap(await w.raiseClaim(AGENT, claim.id, {}));
    const credited = unwrap(await w.creditClaim(AGENT, claim.id));
    expect(credited.status).toBe("credited");
    const cb = (await w.ports.cashbacks.findById(credited.cashbackId!))!;
    expect(cb).toMatchObject({ userId: "usr_member", offerId: "ofr_live", activationId: "act_1", networkTransactionId: null, orderCents: 7990, rateBps: 500, amountCents: 400, marginClamped: false, status: "validated", decidedBy: "claim", decisionReason: "credited_from_claim", validatedAt: NOW });
    expect(await entriesOf(w, cb.id)).toEqual([["manual_credit", "available", 400]]);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 400, reserved: 0, paid: 0 });
    expect(unwrap(await w.listAudit(MANAGER, { entityId: claim.id })).items.map((a) => a.action)).toEqual(["claim.credit", "claim.raise", "claim.acknowledge", "claim.file"]);
    expect(unwrap(await w.listAudit(MANAGER, { entityId: cb.id })).items.map((a) => [a.action, a.actorId])).toEqual([["cashback.create", "usr_agent"]]);
  });

  it("uses the linked unmatched transaction's figures, and matches it", async () => {
    const { w, claim } = await raised();
    unwrap(await w.importFile(MANAGER, file([{ click: "", order: "ORD-CLAIM", amount: "79.90", commission: "3.00" }])));
    const tx = (await w.ports.transactions.list({ page: 1, pageSize: 10 })).items[0]!;
    unwrap(await w.raiseClaim(AGENT, claim.id, { networkTransactionId: tx.id }));
    const credited = unwrap(await w.creditClaim(AGENT, claim.id));
    const cb = (await w.ports.cashbacks.findById(credited.cashbackId!))!;
    expect(cb).toMatchObject({ amountCents: 300, marginClamped: true, networkTransactionId: tx.id });
    expect(await w.ports.transactions.findById(tx.id)).toMatchObject({ matchStatus: "matched", activationId: "act_1" });
  });

  it("refuses when the claim is not raised, when the click already has a cashback, and for a member", async () => {
    const { w, claim } = await raised();
    expect(errorOf(await w.creditClaim(AGENT, claim.id)).code).toBe("conflict");
    unwrap(await w.raiseClaim(AGENT, claim.id, {}));
    expect(errorOf(await w.creditClaim(MEMBER, claim.id)).code).toBe("forbidden");
    unwrap(await w.importFile(MANAGER, file([{ order: "ORD-CLAIM" }])));
    const refused = errorOf(await w.creditClaim(AGENT, claim.id));
    expect(refused.code).toBe("rule");
    expect(refused.message).toMatch(/already has a cashback/);
    expect(unwrap(await w.getClaim(AGENT, claim.id)).status).toBe("raised");
  });

  it("refuses an order the offer's rules exclude, naming the rule", async () => {
    const w = settled({ offers: [offer("ofr_min", "mer_a", { minSpendCents: 10000 })], activations: [activation("act_min", "usr_member", "ofr_min", daysAgo(6))] });
    const claim = unwrap(await w.fileClaim(MEMBER, { ...claimInput, offerId: "ofr_min" }));
    unwrap(await w.acknowledgeClaim(AGENT, claim.id));
    unwrap(await w.raiseClaim(AGENT, claim.id, {}));
    expect(errorOf(await w.creditClaim(AGENT, claim.id)).message).toMatch(/minimum spend/);
  });
});

describe("referral bonuses", () => {
  const referral = (extra: Partial<Referral> = {}): Referral => ({ id: "ref_1", referrerId: "usr_member", refereeId: "usr_other", code: "member", status: "pending", createdAt: daysAgo(20), expiresAt: daysAgo(-70), validatedAt: null, bonusUntil: null, ...extra });
  /** The other member, referred by the member, has three clicks on the live offer. */
  const referred = (extra: Parameters<typeof world>[0] = {}) =>
    world({ referrals: [referral()], activations: [activation("act_r1", "usr_other", "ofr_live", daysAgo(9)), activation("act_r2", "usr_other", "ofr_live", daysAgo(8)), activation("act_r3", "usr_other", "ofr_live", daysAgo(7))], ...extra });
  const rows = (statuses: [string, string, string]) => [
    { ref: "LP1", click: sub("act_r1"), order: "ORD-R1", amount: "60.00", commission: "6.00", status: statuses[0] },
    { ref: "LP2", click: sub("act_r2"), order: "ORD-R2", amount: "60.00", commission: "6.00", status: statuses[1] },
    { ref: "LP3", click: sub("act_r3"), order: "ORD-R3", amount: "60.00", commission: "6.00", status: statuses[2] },
  ];

  it("validates the referral once the referee's validated cashback reaches 5 €, paying both sides, then 10 % of what follows", async () => {
    const w = referred();
    unwrap(await w.importFile(MANAGER, file(rows(["approved", "pending", "pending"]))));
    expect((await w.ports.referrals.findByReferee("usr_other"))?.status).toBe("pending");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 0, reserved: 0, paid: 0 });
    unwrap(await w.importFile(MANAGER, file(rows(["approved", "approved", "pending"]))));
    const r = (await w.ports.referrals.findByReferee("usr_other"))!;
    expect(r).toMatchObject({ status: "validated", validatedAt: NOW, bonusUntil: new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000) });
    expect(await w.ports.ledger.balances("usr_other")).toEqual({ pending: 300, available: 600 + 500, reserved: 0, paid: 0 });
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 2000, reserved: 0, paid: 0 });
    unwrap(await w.importFile(MANAGER, file(rows(["approved", "approved", "approved"]))));
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 2030, reserved: 0, paid: 0 });
    const bonuses = await w.ports.ledger.listByRef("referral", "ref_1");
    expect(bonuses.map((e) => [e.userId, e.kind, e.amountCents, e.note])).toEqual([
      ["usr_other", "referral_bonus", 500, "Welcome bonus"],
      ["usr_member", "referral_bonus", 2000, "Referral bonus"],
      ["usr_member", "referral_bonus", 30, expect.stringMatching(/^10 % of cb_/) as unknown as string],
    ]);
    expect(unwrap(await w.listAudit(MANAGER, { entityType: "referral" })).items.map((a) => a.action)).toEqual(["referral.validate"]);
    expect(unwrap(await w.getReferrals(MEMBER)).bonusCents).toBe(2030);
  });

  it("pays nothing after the bonus year, and expires a referral that misses its window", async () => {
    const w = referred({ referrals: [] });
    w.store.referrals.push(referral({ status: "validated", validatedAt: daysAgo(400), bonusUntil: daysAgo(35) }));
    unwrap(await w.importFile(MANAGER, file(rows(["approved", "approved", "approved"]))));
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 0, reserved: 0, paid: 0 });
    const late = referred({ referrals: [] });
    late.store.referrals.push(referral({ expiresAt: daysAgo(1) }));
    unwrap(await late.importFile(MANAGER, file(rows(["approved", "approved", "approved"]))));
    expect((await late.ports.referrals.findByReferee("usr_other"))?.status).toBe("expired");
    expect(await late.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 0, reserved: 0, paid: 0 });
  });

  it("is paid when a manager validates by hand too, and not for a claim", async () => {
    const w = referred();
    unwrap(await w.importFile(MANAGER, file(rows(["pending", "pending", "pending"]))));
    const pending = (await w.ports.cashbacks.list({ userId: "usr_other", page: 1, pageSize: 10 })).items;
    unwrap(await w.validateCashback(MANAGER, pending[0]!.id, { reason: "proof received" }));
    unwrap(await w.validateCashback(MANAGER, pending[1]!.id, { reason: "proof received" }));
    expect((await w.ports.referrals.findByReferee("usr_other"))?.status).toBe("validated");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 2000, reserved: 0, paid: 0 });
    const claim = unwrap(await w.fileClaim(OTHER, { offerId: "ofr_live", orderRef: "ORD-C", orderedAt: daysAgo(6), orderCents: 20000, proofText: "proof" }));
    unwrap(await w.acknowledgeClaim(AGENT, claim.id));
    unwrap(await w.raiseClaim(AGENT, claim.id, {}));
    expect(errorOf(await w.creditClaim(AGENT, claim.id)).code).toBe("rule");
  });
});

describe("the reconciliation report", () => {
  it("recomputes the book and finds nothing wrong after a run of the pipeline", async () => {
    const w = settled({ activations: [activation("act_3", "usr_member", "ofr_live", daysAgo(10))], ledgerEntries: [entry("led_seed", "usr_member", "available", 3000, { refId: "cb_seed" })], cashbacks: [cashback("cb_seed", "usr_member", "ofr_live", { status: "validated", amountCents: 3000, validatedAt: daysAgo(15) })] });
    unwrap(await w.importFile(MANAGER, file([{}, { ref: "LP2", click: sub("act_3"), order: "ORD-2", status: "approved" }])));
    unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "FR76 •••• 1234" }));
    const report = unwrap(await w.getReconciliation(MANAGER));
    expect(report.ok).toBe(true);
    expect(report.buckets).toEqual({ pending: 650, available: 1650, reserved: 2000, paid: 0 });
    expect(report.checks).toEqual([
      { name: "pending bucket = pending cashbacks", expected: 650, actual: 650, ok: true },
      { name: "available + reserved + paid = validated cashbacks + referral bonuses", expected: 3650, actual: 3650, ok: true },
    ]);
    expect(report.cashbacksOutOfBalance).toEqual([]);
    expect(report.payoutsOutOfBalance).toEqual([]);
    expect(report.negativeBalances).toEqual([]);
    expect(errorOf(await w.getReconciliation(AGENT)).code).toBe("forbidden");
  });

  it("names what is wrong when the book does not agree with the records", async () => {
    const w = settled();
    unwrap(await w.importFile(MANAGER, file([{}])));
    const cb = (await w.ports.cashbacks.list({ page: 1, pageSize: 10 })).items[0]!;
    w.store.ledgerEntries.push(entry("led_stray", "usr_member", "available", -100, { kind: "cashback_adjusted", refId: cb.id }));
    const report = unwrap(await w.getReconciliation(MANAGER));
    expect(report.ok).toBe(false);
    expect(report.checks[1]).toMatchObject({ expected: 0, actual: -100, ok: false });
    expect(report.cashbacksOutOfBalance).toEqual([cb.id]);
    expect(report.negativeBalances).toEqual([{ userId: "usr_member", bucket: "available", amountCents: -100 }]);
  });
});
