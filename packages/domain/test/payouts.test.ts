import { describe, expect, it } from "vitest";
import { AGENT, MANAGER, MEMBER, NOW, OTHER, cashback, daysAgo, entry, errorOf, unwrap, world } from "./harness.js";

const funded = () => world({ ledgerEntries: [entry("led_1", "usr_member", "available", 3000), entry("led_2", "usr_other", "available", 1000)] });

describe("requestPayout", () => {
  it("reserves the amount: a requested payout, two ledger entries and an audit row", async () => {
    const w = funded();
    const p = unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2500, destination: "FR76 •••• 1234" }));
    expect(p.status).toBe("requested");
    expect(p.requestedAt).toEqual(NOW);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 500, reserved: 2500, paid: 0 });
    const entries = await w.ports.ledger.listByRef("payout", p.id);
    expect(entries.map((e) => [e.kind, e.bucket, e.amountCents])).toEqual([
      ["payout_reserved", "available", -2500],
      ["payout_reserved", "reserved", 2500],
    ]);
    const audit = unwrap(await w.listAudit(MANAGER, { entityId: p.id }));
    expect(audit.items.map((a) => a.action)).toEqual(["payout.request"]);
    expect(audit.items[0]?.actorId).toBe("usr_member");
  });

  it("enforces the minimum per method and the 5 € step for a transfer", async () => {
    const w = funded();
    expect(errorOf(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 1500, destination: "x" })).code).toBe("rule");
    expect(errorOf(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2100, destination: "x" })).code).toBe("rule");
    expect(errorOf(await w.requestPayout(MEMBER, { method: "gift_card", amountCents: 1400, destination: "Maison Vernet" })).code).toBe("rule");
    expect(errorOf(await w.requestPayout(MEMBER, { method: "donation", amountCents: 499, destination: "Forêt Vivante" })).code).toBe("rule");
    expect(unwrap(await w.requestPayout(MEMBER, { method: "donation", amountCents: 500, destination: "Forêt Vivante" })).amountCents).toBe(500);
    expect(unwrap(await w.requestPayout(MEMBER, { method: "gift_card", amountCents: 1537, destination: "Maison Vernet" })).amountCents).toBe(1537);
  });

  it("refuses more than the available balance, and writes nothing", async () => {
    const w = funded();
    const e = errorOf(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 3500, destination: "x" }));
    expect(e.code).toBe("rule");
    expect(e.message).toMatch(/available/);
    expect(w.store.payouts).toHaveLength(0);
    expect(w.store.ledgerEntries).toHaveLength(2);
  });

  it("requires a destination", async () => {
    expect(errorOf(await funded().requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "  " })).code).toBe("invalid");
  });
});

describe("the payouts queue", () => {
  it("lists a member's own payouts and, for a manager, everyone's by status", async () => {
    const w = funded();
    unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "x" }));
    unwrap(await w.requestPayout(OTHER, { method: "donation", amountCents: 1000, destination: "y" }));
    expect(unwrap(await w.listPayouts(MEMBER, {})).items.map((p) => p.userId)).toEqual(["usr_member"]);
    expect(unwrap(await w.listPayouts(MANAGER, {})).total).toBe(2);
    expect(unwrap(await w.listPayouts(MANAGER, { status: "requested" })).items[0]?.member.email).toBe("other@example.com");
    expect(unwrap(await w.listPayouts(AGENT, {})).total).toBe(0);
  });

  it("walks requested → checking → sent, moving the money from reserved to paid", async () => {
    const w = funded();
    const p = unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "x" }));
    expect(unwrap(await w.checkPayout(MANAGER, p.id)).status).toBe("checking");
    expect(errorOf(await w.checkPayout(MANAGER, p.id)).code).toBe("conflict");
    const sent = unwrap(await w.sendPayout(MANAGER, p.id));
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toEqual(NOW);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 1000, reserved: 0, paid: 2000 });
    expect(unwrap(await w.listAudit(MANAGER, { entityId: p.id })).items.map((a) => a.action)).toEqual(["payout.send", "payout.check", "payout.request"]);
  });

  it("fails a payout from either open state and gives the money back", async () => {
    const w = funded();
    const p = unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "x" }));
    const failed = unwrap(await w.failPayout(MANAGER, p.id, { reason: "returned_by_bank" }));
    expect(failed.status).toBe("failed");
    expect(failed.failedReason).toBe("returned_by_bank");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 3000, reserved: 0, paid: 0 });
    expect(errorOf(await w.sendPayout(MANAGER, p.id)).code).toBe("conflict");
    expect(errorOf(await w.failPayout(MANAGER, p.id, { reason: "again" })).code).toBe("conflict");
  });

  it("refuses sending straight from requested, and refuses agents and members", async () => {
    const w = funded();
    const p = unwrap(await w.requestPayout(MEMBER, { method: "transfer", amountCents: 2000, destination: "x" }));
    expect(errorOf(await w.sendPayout(MANAGER, p.id)).code).toBe("conflict");
    expect(errorOf(await w.checkPayout(AGENT, p.id)).code).toBe("forbidden");
    expect(errorOf(await w.checkPayout(MEMBER, p.id)).code).toBe("forbidden");
    expect(errorOf(await w.checkPayout(MANAGER, "pay_nope")).code).toBe("not_found");
  });
});

describe("manual decisions on a cashback", () => {
  const pendingWorld = () =>
    world({
      cashbacks: [cashback("cb_1", "usr_member", "ofr_live", { amountCents: 800 }), cashback("cb_2", "usr_member", "ofr_live", { amountCents: 500, status: "validated", validatedAt: daysAgo(5) })],
      ledgerEntries: [entry("led_1", "usr_member", "pending", 800, { kind: "cashback_pending", refId: "cb_1" }), entry("led_2", "usr_member", "pending", 500, { kind: "cashback_pending", refId: "cb_2", createdAt: daysAgo(30) }), entry("led_3", "usr_member", "pending", -500, { refId: "cb_2" }), entry("led_4", "usr_member", "available", 500, { refId: "cb_2" })],
    });

  it("validates a pending cashback by hand: pending to available, decided by the manager", async () => {
    const w = pendingWorld();
    const c = unwrap(await w.validateCashback(MANAGER, "cb_1", { reason: "confirmed by the merchant" }));
    expect(c.status).toBe("validated");
    expect(c.decidedBy).toBe("manager");
    expect(c.validatedAt).toEqual(NOW);
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 1300, reserved: 0, paid: 0 });
    expect((await w.ports.ledger.listByRef("cashback", "cb_1")).map((e) => [e.kind, e.bucket, e.amountCents])).toEqual([
      ["cashback_pending", "pending", 800],
      ["cashback_validated", "pending", -800],
      ["cashback_validated", "available", 800],
    ]);
    expect(unwrap(await w.listAudit(MANAGER, { entityId: "cb_1" })).items[0]?.reason).toBe("confirmed by the merchant");
  });

  it("refuses a pending cashback: the pending entry is reversed", async () => {
    const w = pendingWorld();
    const c = unwrap(await w.refuseCashback(MANAGER, "cb_1", { reason: "order_returned" }));
    expect(c.status).toBe("refused");
    expect(c.decisionReason).toBe("order_returned");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 500, reserved: 0, paid: 0 });
    expect(errorOf(await w.validateCashback(MANAGER, "cb_1", { reason: "x" })).code).toBe("conflict");
  });

  it("cancels a validated cashback only while the available balance covers it", async () => {
    const w = pendingWorld();
    unwrap(await w.requestPayout(MEMBER, { method: "donation", amountCents: 500, destination: "charity" }));
    const e = errorOf(await w.cancelCashback(MANAGER, "cb_2", { reason: "order_returned" }));
    expect(e.code).toBe("rule");
    unwrap(await w.failPayout(MANAGER, w.store.payouts[0]!.id, { reason: "x" }));
    const c = unwrap(await w.cancelCashback(MANAGER, "cb_2", { reason: "order_returned" }));
    expect(c.status).toBe("cancelled");
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 800, available: 0, reserved: 0, paid: 0 });
  });

  it("cancels a pending cashback by reversing the pending entry", async () => {
    const w = pendingWorld();
    unwrap(await w.cancelCashback(MANAGER, "cb_1", { reason: "duplicate" }));
    expect(await w.ports.ledger.balances("usr_member")).toEqual({ pending: 0, available: 500, reserved: 0, paid: 0 });
  });

  it("requires a reason and the manager role", async () => {
    const w = pendingWorld();
    expect(errorOf(await w.refuseCashback(MANAGER, "cb_1", { reason: " " })).code).toBe("invalid");
    expect(errorOf(await w.refuseCashback(AGENT, "cb_1", { reason: "x" })).code).toBe("forbidden");
    expect(errorOf(await w.refuseCashback(MANAGER, "cb_nope", { reason: "x" })).code).toBe("not_found");
  });
});
