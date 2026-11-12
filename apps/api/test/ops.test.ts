import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApi, type TestApi } from "./harness.js";

/* The back office, as Sam (agent) and Nadia (manager), against the seed. */

let api: TestApi;
let sam: string;
let nadia: string;
beforeAll(async () => {
  api = await testApi();
  sam = api.tokens.agent;
  nadia = api.tokens.manager;
});
afterAll(() => api.close());

const agentId = () => api.seed.users[1]!.id;
const managerId = () => api.seed.users[2]!.id;

describe("the claims queue", () => {
  it("lists every claim with filters and shows one with the member and the offer", async () => {
    const all = await api.call("GET", "/claims", { token: sam });
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(api.seed.claims.length);
    const filed = await api.call("GET", "/claims?status=filed&pageSize=50", { token: sam });
    expect(filed.body.total).toBe(api.seed.claims.filter((c) => c.status === "filed").length);
    const ref = api.seed.claims[0]!.orderRef;
    const byRef = await api.call("GET", `/claims?q=${ref.slice(4)}`, { token: sam });
    expect(byRef.body.items.map((c: { id: string }) => c.id)).toContain(api.seed.claims[0]!.id);
    const detail = await api.call("GET", `/claims/${api.seed.claims[0]!.id}`, { token: sam });
    expect(detail.body.member.email).toBeTypeOf("string");
    expect(detail.body.offer.merchant.name).toBeTypeOf("string");
  });

  it("walks a filed claim to raised then declined, writing the audit trail", async () => {
    const claim = api.seed.claims.find((c) => c.status === "filed")!;
    const ack = await api.call("POST", `/claims/${claim.id}/acknowledge`, { token: sam });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe("acknowledged");
    expect(ack.body.assigneeId).toBe(agentId());
    expect((await api.call("POST", `/claims/${claim.id}/acknowledge`, { token: sam })).status).toBe(409);
    const raised = await api.call("POST", `/claims/${claim.id}/raise`, { token: sam, body: {} });
    expect(raised.body.status).toBe("raised");
    expect((await api.call("POST", `/claims/${claim.id}/decline`, { token: sam, body: { reason: "because" } })).status).toBe(400);
    const declined = await api.call("POST", `/claims/${claim.id}/decline`, { token: sam, body: { reason: "order_not_found_at_network" } });
    expect(declined.body.status).toBe("declined");
    const audit = await api.call("GET", `/audit?entityType=claim&entityId=${claim.id}`, { token: nadia });
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(["claim.decline", "claim.raise", "claim.acknowledge"]);
    expect(audit.body.items[0].reason).toBe("order_not_found_at_network");
    expect(audit.body.items[0].actorId).toBe(agentId());
  });

  it("assigns a claim to a manager and raises it with an unmatched transaction of the same merchant", async () => {
    const claim = api.seed.claims.find((c) => c.status === "acknowledged")!;
    const offer = api.seed.offers.find((o) => o.id === claim.offerId)!;
    const assigned = await api.call("POST", `/claims/${claim.id}/assign`, { token: sam, body: { assigneeId: managerId() } });
    expect(assigned.body.assigneeId).toBe(managerId());
    expect((await api.call("POST", `/claims/${claim.id}/assign`, { token: sam, body: { assigneeId: api.seed.users[0]!.id } })).status).toBe(422);
    const tx = api.seed.networkTransactions.find((t) => t.merchantId === offer.merchantId && t.matchStatus === "unmatched")!;
    const matched = api.seed.networkTransactions.find((t) => t.matchStatus === "matched")!;
    expect((await api.call("POST", `/claims/${claim.id}/raise`, { token: sam, body: { networkTransactionId: matched.id } })).status).toBe(422);
    const raised = await api.call("POST", `/claims/${claim.id}/raise`, { token: sam, body: { networkTransactionId: tx.id } });
    expect(raised.status).toBe(200);
    expect(raised.body.networkTransactionId).toBe(tx.id);
  });

  it("lets an agent read a member's wallet and cashbacks for a claim", async () => {
    const claim = api.seed.claims[0]!;
    const wallet = await api.call("GET", `/users/${claim.userId}/wallet`, { token: sam });
    expect(wallet.status).toBe(200);
    expect(wallet.body.userId).toBe(claim.userId);
    const cashbacks = await api.call("GET", `/users/${claim.userId}/cashbacks?status=validated`, { token: sam });
    expect(cashbacks.body.total).toBe(api.seed.cashbacks.filter((c) => c.userId === claim.userId && c.status === "validated").length);
    expect((await api.call("GET", "/users/usr_nope/wallet", { token: sam })).status).toBe(404);
  });
});

describe("the payouts queue", () => {
  it("lists by status with the member, and walks requested → checking → sent", async () => {
    const queue = await api.call("GET", "/payouts?status=requested", { token: nadia });
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(api.seed.payouts.filter((p) => p.status === "requested").length);
    const payout = queue.body.items[0];
    expect(payout.member.email).toBeTypeOf("string");
    expect((await api.call("POST", `/payouts/${payout.id}/send`, { token: nadia })).status).toBe(409);
    expect((await api.call("POST", `/payouts/${payout.id}/check`, { token: nadia })).body.status).toBe("checking");
    const sent = await api.call("POST", `/payouts/${payout.id}/send`, { token: nadia });
    expect(sent.body.status).toBe("sent");
    const wallet = await api.call("GET", `/users/${payout.userId}/wallet`, { token: nadia });
    const byHand = { pending: 0, available: 0, reserved: 0, paid: 0 };
    for (const e of api.seed.ledgerEntries) if (e.userId === payout.userId) byHand[e.bucket] += e.amountCents;
    expect(wallet.body.balances).toEqual({ ...byHand, reserved: byHand.reserved - payout.amountCents, paid: byHand.paid + payout.amountCents });
  });

  it("fails a checking payout with a reason and gives the money back", async () => {
    const payout = api.seed.payouts.find((p) => p.status === "checking")!;
    expect((await api.call("POST", `/payouts/${payout.id}/fail`, { token: nadia, body: {} })).status).toBe(400);
    const failed = await api.call("POST", `/payouts/${payout.id}/fail`, { token: nadia, body: { reason: "returned_by_bank" } });
    expect(failed.body.status).toBe("failed");
    expect(failed.body.failedReason).toBe("returned_by_bank");
    const entries = (await api.call("GET", `/users/${payout.userId}/wallet?pageSize=2`, { token: nadia })).body.ledger.items;
    expect(entries.map((e: { kind: string; bucket: string; amountCents: number }) => [e.kind, e.bucket, e.amountCents]).sort()).toEqual([
      ["payout_failed", "available", payout.amountCents],
      ["payout_failed", "reserved", -payout.amountCents],
    ]);
  });
});

describe("decisions on a cashback", () => {
  it("validates a pending cashback by hand and moves it to available", async () => {
    const cb = api.seed.cashbacks.find((c) => c.status === "pending")!;
    const before = (await api.call("GET", `/users/${cb.userId}/wallet`, { token: nadia })).body.balances;
    const res = await api.call("POST", `/cashbacks/${cb.id}/validate`, { token: nadia, body: { reason: "confirmed by the merchant by email" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "validated", decidedBy: "manager", decisionReason: "confirmed by the merchant by email" });
    const after = (await api.call("GET", `/users/${cb.userId}/wallet`, { token: nadia })).body.balances;
    expect(after).toEqual({ ...before, pending: before.pending - cb.amountCents, available: before.available + cb.amountCents });
    expect((await api.call("POST", `/cashbacks/${cb.id}/validate`, { token: nadia, body: { reason: "again" } })).status).toBe(409);
    expect((await api.call("POST", `/cashbacks/${cb.id}/refuse`, { token: nadia, body: { reason: "x" } })).status).toBe(409);
  });

  it("refuses and cancels with a reason, and needs one", async () => {
    const [a, b] = api.seed.cashbacks.filter((c) => c.status === "pending").slice(1, 3) as [typeof api.seed.cashbacks[number], typeof api.seed.cashbacks[number]];
    expect((await api.call("POST", `/cashbacks/${a.id}/refuse`, { token: nadia, body: { reason: "" } })).status).toBe(400);
    expect((await api.call("POST", `/cashbacks/${a.id}/refuse`, { token: nadia, body: { reason: "order_returned" } })).body.status).toBe("refused");
    expect((await api.call("POST", `/cashbacks/${b.id}/cancel`, { token: nadia, body: { reason: "duplicate" } })).body.status).toBe("cancelled");
  });
});

describe("the catalogue", () => {
  it("creates a merchant, an offer, publishes it, boosts it, pauses and ends it", async () => {
    expect((await api.call("GET", "/merchants", { token: sam })).body.length).toBe(api.seed.merchants.length);
    const merchant = await api.call("POST", "/merchants", { token: nadia, body: { slug: "nouvelle-boutique", name: "Nouvelle Boutique", category: "home", country: "fr", attributionDays: 21, network: "linkpool", advertiserRef: "LP-9999" } });
    expect(merchant.status).toBe(201);
    expect(merchant.body.country).toBe("FR");
    expect((await api.call("POST", "/merchants", { token: nadia, body: { ...merchant.body, id: undefined, advertiserRef: "LP-10000" } })).status).toBe(409);

    const offer = await api.call("POST", "/offers", { token: nadia, body: { merchantId: merchant.body.id, kind: "online", title: "Nouvelle Boutique: 5 % back", rateKind: "percent", rateBps: 500, validationDays: 30, startsAt: "2026-11-01T00:00:00Z" } });
    expect(offer.status).toBe(201);
    expect(offer.body.status).toBe("draft");
    expect((await api.call("POST", "/offers", { token: nadia, body: { merchantId: merchant.body.id, kind: "online", title: "Bad", rateKind: "percent", rateBps: 500, fixedCents: 100, validationDays: 30, startsAt: "2026-11-01T00:00:00Z" } })).status).toBe(400);
    expect((await api.call("GET", `/offers/${offer.body.id}`, { token: api.tokens.member })).status).toBe(404);

    expect((await api.call("PATCH", `/offers/${offer.body.id}`, { token: nadia, body: { rateBps: 600 } })).body.rateBps).toBe(600);
    expect((await api.call("POST", `/offers/${offer.body.id}/pause`, { token: nadia })).status).toBe(409);
    expect((await api.call("POST", `/offers/${offer.body.id}/publish`, { token: nadia })).body.status).toBe("live");
    expect((await api.call("GET", `/offers/${offer.body.id}`, { token: api.tokens.member })).status).toBe(200);

    const boost = await api.call("POST", `/offers/${offer.body.id}/boosts`, { token: nadia, body: { rateBps: 900, startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-08T00:00:00Z" } });
    expect(boost.status).toBe(201);
    expect((await api.call("POST", `/offers/${offer.body.id}/boosts`, { token: nadia, body: { rateBps: 1000, startsAt: "2026-12-05T00:00:00Z", endsAt: "2026-12-10T00:00:00Z" } })).status).toBe(409);
    expect((await api.call("POST", `/offers/${offer.body.id}/boosts`, { token: nadia, body: { rateBps: 400, startsAt: "2027-01-01T00:00:00Z", endsAt: "2027-01-02T00:00:00Z" } })).status).toBe(422);
    expect((await api.call("GET", `/offers/${offer.body.id}`, { token: nadia })).body.boosts).toHaveLength(1);

    expect((await api.call("POST", `/offers/${offer.body.id}/pause`, { token: nadia })).body.status).toBe("paused");
    expect((await api.call("POST", `/offers/${offer.body.id}/resume`, { token: nadia })).body.status).toBe("live");
    expect((await api.call("POST", `/offers/${offer.body.id}/end`, { token: nadia })).body.status).toBe("ended");
    expect((await api.call("PATCH", `/offers/${offer.body.id}`, { token: nadia, body: { title: "x" } })).status).toBe(409);
    const audit = await api.call("GET", `/audit?entityId=${offer.body.id}`, { token: nadia });
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(["offer.end", "offer.resume", "offer.pause", "offer.boost", "offer.publish", "offer.update", "offer.create"]);
  });
});

describe("the reports", () => {
  it("gives the overview from the seed", async () => {
    const res = await api.call("GET", "/reports/overview", { token: nadia });
    expect(res.status).toBe(200);
    expect(res.body.members).toBe(api.seed.users.filter((u) => u.role === "member").length);
    expect(res.body.liveOffers).toBeGreaterThan(0);
    expect(res.body.unmatchedTransactions).toBe(api.seed.networkTransactions.filter((t) => t.matchStatus === "unmatched").length);
    expect(res.body.pendingCashbacks.count).toBeGreaterThan(0);
    expect(res.body.validatedLast30DaysCents).toBeGreaterThan(0);
    expect(res.body.validatedCents).toBeGreaterThan(res.body.validatedLast30DaysCents);
  });

  it("gives the margin by merchant for a window, totals included", async () => {
    const res = await api.call("GET", "/reports/margin?from=2026-09-01&to=2026-10-01", { token: nadia });
    expect(res.status).toBe(200);
    expect(res.body.lines.length).toBeGreaterThan(30);
    const totals = res.body.lines.reduce((n: number, l: { marginCents: number }) => n + l.marginCents, 0);
    expect(res.body.totals.marginCents).toBe(totals);
    expect(res.body.totals.marginCents).toBe(res.body.totals.commissionCents - res.body.totals.cashbackCents);
    expect((await api.call("GET", "/reports/margin?from=2026-10-01&to=2026-09-01", { token: nadia })).status).toBe(400);
    expect((await api.call("GET", "/reports/margin?from=whenever", { token: nadia })).status).toBe(400);
  });

  it("pages the audit log by entity and actor", async () => {
    const res = await api.call("GET", "/audit?entityType=payout&pageSize=5", { token: nadia });
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items.every((a: { entityType: string }) => a.entityType === "payout")).toBe(true);
    const byActor = await api.call("GET", `/audit?actorId=${agentId()}`, { token: nadia });
    expect(byActor.body.items.every((a: { actorId: string }) => a.actorId === agentId())).toBe(true);
  });
});
