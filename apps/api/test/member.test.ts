import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApi, type TestApi } from "./harness.js";

/* The member's side, as Marie, against the seed: browse, activate, wallet, cash out, claim, referrals. */

let api: TestApi;
let marie: string;
beforeAll(async () => {
  api = await testApi();
  marie = api.tokens.member;
});
afterAll(() => api.close());

const marieId = () => api.seed.users[0]!.id;

describe("GET /offers", () => {
  it("pages live offers by rate with the merchant on each", async () => {
    const res = await api.call("GET", "/offers?pageSize=5", { token: marie });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.total).toBe(api.seed.offers.filter((o) => o.status === "live").length);
    expect(res.body.items.every((o: { status: string }) => o.status === "live")).toBe(true);
    expect(res.body.items[0].merchant.name).toBeTypeOf("string");
    const rates = res.body.items.map((o: { rateBps: number }) => o.rateBps);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
  });

  it("filters by text, category and kind, and sorts by name or newest", async () => {
    const q = await api.call("GET", "/offers?q=vernet", { token: marie });
    expect(q.body.items.every((o: { merchant: { name: string } }) => o.merchant.name === "Maison Vernet")).toBe(true);
    expect(q.body.total).toBeGreaterThan(0);
    const travel = await api.call("GET", "/offers?category=travel&sort=name", { token: marie });
    expect(travel.body.items.every((o: { merchant: { category: string } }) => o.merchant.category === "travel")).toBe(true);
    const vouchers = await api.call("GET", "/offers?kind=voucher", { token: marie });
    expect(vouchers.body.total).toBe(5);
    expect((await api.call("GET", "/offers?sort=price", { token: marie })).status).toBe(400);
    expect((await api.call("GET", "/offers?pageSize=100", { token: marie })).status).toBe(400);
  });

  it("ignores all=1 for a member and honours it for a manager", async () => {
    const asMember = await api.call("GET", "/offers?all=1", { token: marie });
    const asManager = await api.call("GET", "/offers?all=1", { token: api.tokens.manager });
    expect(asMember.body.total).toBe(api.seed.offers.filter((o) => o.status === "live").length);
    expect(asManager.body.total).toBe(api.seed.offers.length);
  });
});

describe("activating an offer", () => {
  it("shows the detail with the rate in force and records the activation", async () => {
    const live = api.seed.offers.find((o) => o.status === "live" && o.rateKind === "percent")!;
    const detail = await api.call("GET", `/offers/${live.id}`, { token: marie });
    expect(detail.status).toBe(200);
    expect(detail.body.rateInForce.rateBps).toBeGreaterThanOrEqual(live.rateBps);
    expect(Array.isArray(detail.body.boosts)).toBe(true);

    const res = await api.call("POST", `/offers/${live.id}/activate`, { token: marie });
    expect(res.status).toBe(201);
    expect(res.body.subId).toMatch(/^[a-z0-9]{16}$/);
    expect(res.body.trackingUrl).toContain(res.body.subId);
    expect(res.body.rateBps).toBe(detail.body.rateInForce.rateBps);

    const mine = await api.call("GET", "/me/activations?pageSize=1", { token: marie });
    expect(mine.body.items[0].id).toBe(res.body.id);
    expect(mine.body.items[0].offer.merchant.name).toBeTypeOf("string");
  });

  it("refuses a paused or draft offer with 422 and hides it with 404 on the detail", async () => {
    const paused = api.seed.offers.find((o) => o.status === "paused")!;
    expect((await api.call("GET", `/offers/${paused.id}`, { token: marie })).status).toBe(404);
    expect((await api.call("POST", `/offers/${paused.id}/activate`, { token: marie })).status).toBe(422);
  });
});

describe("the wallet and the cashbacks", () => {
  it("sums Marie's buckets from her ledger and pages the entries", async () => {
    const res = await api.call("GET", "/me/wallet?pageSize=10", { token: marie });
    expect(res.status).toBe(200);
    const byHand = { pending: 0, available: 0, reserved: 0, paid: 0 };
    for (const e of api.seed.ledgerEntries) if (e.userId === marieId()) byHand[e.bucket] += e.amountCents;
    expect(res.body.balances).toEqual(byHand);
    expect(res.body.ledger.items).toHaveLength(10);
    expect(res.body.ledger.total).toBe(api.seed.ledgerEntries.filter((e) => e.userId === marieId()).length);
  });

  it("lists her cashbacks by status and shows one with its entries", async () => {
    const pending = await api.call("GET", "/me/cashbacks?status=pending", { token: marie });
    expect(pending.body.total).toBe(api.seed.cashbacks.filter((c) => c.userId === marieId() && c.status === "pending").length);
    const first = pending.body.items[0];
    const detail = await api.call("GET", `/me/cashbacks/${first.id}`, { token: marie });
    expect(detail.status).toBe(200);
    expect(detail.body.offer.merchant.name).toBeTypeOf("string");
    expect(detail.body.entries.map((e: { bucket: string; amountCents: number }) => [e.bucket, e.amountCents])).toEqual([["pending", first.amountCents]]);
  });

  it("keeps another member's cashback out of reach", async () => {
    const other = api.seed.cashbacks.find((c) => c.userId !== marieId())!;
    expect((await api.call("GET", `/me/cashbacks/${other.id}`, { token: marie })).status).toBe(403);
  });
});

describe("cashing out", () => {
  it("reserves a transfer and shows it in the payouts and the wallet", async () => {
    const before = (await api.call("GET", "/me/wallet", { token: marie })).body.balances;
    const res = await api.call("POST", "/me/payouts", { token: marie, body: { method: "transfer", amountCents: 2000, destination: "FR76 •••• •••• •••• 0000" } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("requested");
    const after = (await api.call("GET", "/me/wallet", { token: marie })).body.balances;
    expect(after.available).toBe(before.available - 2000);
    expect(after.reserved).toBe(before.reserved + 2000);
    const list = await api.call("GET", "/me/payouts", { token: marie });
    expect(list.body.items[0].id).toBe(res.body.id);
  });

  it("answers 422 below the minimum, off the step, or beyond the balance, and 400 for a bad body", async () => {
    expect((await api.call("POST", "/me/payouts", { token: marie, body: { method: "transfer", amountCents: 1500, destination: "x" } })).status).toBe(422);
    expect((await api.call("POST", "/me/payouts", { token: marie, body: { method: "transfer", amountCents: 2100, destination: "x" } })).status).toBe(422);
    const huge = await api.call("POST", "/me/payouts", { token: marie, body: { method: "transfer", amountCents: 1_000_000_00, destination: "x" } });
    expect(huge.status).toBe(422);
    expect(huge.body.error.message).toMatch(/available/);
    expect((await api.call("POST", "/me/payouts", { token: marie, body: { method: "cheque", amountCents: 2000, destination: "x" } })).status).toBe(400);
  });
});

describe("claims", () => {
  it("files a claim on an activated offer and lists it", async () => {
    const activation = api.seed.activations.find((a) => a.userId === marieId() && a.activatedAt < new Date("2026-11-01T00:00:00Z") && a.activatedAt > new Date("2026-09-01T00:00:00Z"))!;
    const orderedAt = new Date(activation.activatedAt.getTime() + 3600_000).toISOString();
    const res = await api.call("POST", "/me/claims", { token: marie, body: { offerId: activation.offerId, orderRef: "ORD-TEST001", orderedAt, orderCents: 4990, proofText: "Order confirmation ORD-TEST001" } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("filed");
    const mine = await api.call("GET", "/me/claims", { token: marie });
    expect(mine.body.items[0].id).toBe(res.body.id);
    expect(mine.body.items[0].offer.merchant.name).toBeTypeOf("string");
    expect((await api.call("GET", `/me/claims/${res.body.id}`, { token: marie })).status).toBe(200);
  });

  it("refuses a claim without an activation (422), a bad date (400) and someone else's claim (403)", async () => {
    const neverActivated = api.seed.offers.find((o) => o.status === "live" && !api.seed.activations.some((a) => a.userId === marieId() && a.offerId === o.id))!;
    const res = await api.call("POST", "/me/claims", { token: marie, body: { offerId: neverActivated.id, orderRef: "ORD-X", orderedAt: "2026-11-01T10:00:00Z", orderCents: 4990, proofText: "..." } });
    expect(res.status).toBe(422);
    expect((await api.call("POST", "/me/claims", { token: marie, body: { offerId: neverActivated.id, orderRef: "ORD-X", orderedAt: "soon", orderCents: 4990, proofText: "..." } })).status).toBe(400);
    const theirs = api.seed.claims.find((c) => c.userId !== marieId())!;
    expect((await api.call("GET", `/me/claims/${theirs.id}`, { token: marie })).status).toBe(403);
  });
});

describe("GET /me/referrals", () => {
  it("shows Marie's code, her referees and her bonuses", async () => {
    const res = await api.call("GET", "/me/referrals", { token: marie });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(api.seed.users[0]!.referralCode);
    expect(res.body.referees.length).toBe(api.seed.referrals.filter((r) => r.referrerId === marieId()).length);
    expect(res.body.bonusCents).toBe(api.seed.ledgerEntries.filter((e) => e.userId === marieId() && e.kind === "referral_bonus").reduce((n, e) => n + e.amountCents, 0));
    expect(res.body.remaining).toBe(20 - res.body.referees.length);
  });
});
