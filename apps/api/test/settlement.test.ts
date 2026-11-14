import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApi, type TestApi } from "./harness.js";

/*
 * The settlement routes against the seed: Nadia (manager) imports a network file about clicks the
 * seed never settled, works the transactions queue, and reads the reconciliation; Sam (agent)
 * credits a raised claim.
 */

let api: TestApi;
let nadia: string;
let sam: string;
beforeAll(async () => {
  api = await testApi();
  nadia = api.tokens.manager;
  sam = api.tokens.agent;
});
afterAll(() => api.close());

const HEADER = "transaction_id,advertiser_id,click_ref,order_ref,transaction_date,sale_amount,commission_amount,status,last_updated";
const DAY = 24 * 60 * 60 * 1000;

/** A seed activation on a live percent offer at a linkpool merchant that no network transaction ever reported. */
function orphanActivation() {
  const settled = new Set(api.seed.networkTransactions.map((t) => t.activationId));
  const claimed = new Set(api.seed.claims.map((c) => c.userId + c.offerId));
  const withCashback = new Set(api.seed.cashbacks.map((c) => c.activationId));
  const offers = new Map(api.seed.offers.map((o) => [o.id, o]));
  const merchants = new Map(api.seed.merchants.map((m) => [m.id, m]));
  const a = api.seed.activations.find((x) => {
    const offer = offers.get(x.offerId)!;
    const merchant = merchants.get(offer.merchantId)!;
    return !settled.has(x.id) && !withCashback.has(x.id) && !claimed.has(x.userId + x.offerId) && offer.rateKind === "percent" && offer.minSpendCents === 0 && !offer.newCustomersOnly && merchant.network === "linkpool" && x.activatedAt.getTime() > Date.now() - 20 * DAY;
  })!;
  const offer = offers.get(a.offerId)!;
  return { activation: a, offer, merchant: merchants.get(offer.merchantId)! };
}

const line = (fields: string[]) => fields.join(",");

/** The click the first import settles, so later tests know it has a cashback the seed does not list. */
let settledTonight = "";

describe("POST /imports", () => {
  it("runs a file through the pipeline and answers the batch summary", async () => {
    const { activation, merchant } = orphanActivation();
    settledTonight = activation.id;
    const orderedAt = new Date(activation.activatedAt.getTime() + 2 * 60 * 60 * 1000);
    const content = [
      HEADER,
      line(["LPTEST1", merchant.advertiserRef, activation.subId, "ORD-TEST-1", orderedAt.toISOString(), "100.00", "9.00", "pending", new Date().toISOString()]),
      line(["LPTEST2", merchant.advertiserRef, "", "ORD-TEST-2", orderedAt.toISOString(), "55.00", "3.30", "approved", new Date().toISOString()]),
      line(["LPTEST3", "LP-nobody", "", "ORD-TEST-3", orderedAt.toISOString(), "55.00", "3.30", "approved", new Date().toISOString()]),
    ].join("\n");
    const res = await api.call("POST", "/imports", { token: nadia, body: { network: "linkpool", filename: "linkpool-test.csv", content } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "processed", rowCount: 3, newCount: 2, updatedCount: 0, matchedCount: 1, unmatchedCount: 1, errorCount: 1, errors: [{ line: 4, message: "advertiser LP-nobody is not a merchant on linkpool" }] });

    const cashbacks = await api.call("GET", `/users/${activation.userId}/cashbacks?status=pending`, { token: nadia });
    const booked = cashbacks.body.items.find((c: { activationId: string }) => c.activationId === activation.id);
    expect(booked).toMatchObject({ orderCents: 10000, rateBps: activation.rateBps, status: "pending" });
    expect(booked.amountCents).toBe(Math.min(Math.floor((10000 * activation.rateBps + 5000) / 10000), 900));

    const list = await api.call("GET", `/imports`, { token: nadia });
    expect(list.body.items[0].id).toBe(res.body.id);
    expect(list.body.total).toBe(api.seed.importBatches.length + 1);
    const one = await api.call("GET", `/imports/${res.body.id}`, { token: nadia });
    expect(one.body.filename).toBe("linkpool-test.csv");
    expect((await api.call("GET", "/imports/imp_nope", { token: nadia })).status).toBe(404);
  });

  it("refuses a body it cannot read and a file it cannot parse is a failed batch", async () => {
    expect((await api.call("POST", "/imports", { token: nadia, body: { network: "nowhere", filename: "x", content: "y" } })).status).toBe(400);
    expect((await api.call("POST", "/imports", { token: nadia, body: { network: "affinet", filename: "x.json" } })).status).toBe(400);
    const failed = await api.call("POST", "/imports", { token: nadia, body: { network: "affinet", filename: "broken.json", content: "nope" } });
    expect(failed.status).toBe(201);
    expect(failed.body.status).toBe("failed");
  });
});

describe("the transactions queue", () => {
  it("lists with filters and shows one with its merchant, click, cashback and candidates", async () => {
    const all = await api.call("GET", "/transactions", { token: nadia });
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThan(api.seed.networkTransactions.length);
    const unmatched = await api.call("GET", "/transactions?match=unmatched&network=affinet&pageSize=5", { token: nadia });
    expect(unmatched.body.items.every((t: { matchStatus: string; network: string }) => t.matchStatus === "unmatched" && t.network === "affinet")).toBe(true);
    expect(unmatched.body.items[0].merchant.name).toBeTypeOf("string");
    const batch = api.seed.importBatches[0]!;
    expect((await api.call("GET", `/transactions?batch=${batch.id}`, { token: nadia })).body.total).toBe(api.seed.networkTransactions.filter((t) => t.batchId === batch.id).length);

    const matched = api.seed.networkTransactions.find((t) => t.matchStatus === "matched")!;
    const detail = await api.call("GET", `/transactions/${matched.id}`, { token: nadia });
    expect(detail.body.activation.id).toBe(matched.activationId);
    expect(detail.body.activation.member.email).toBeTypeOf("string");
    expect(detail.body.cashback.networkTransactionId).toBe(matched.id);
    expect(detail.body.candidates).toEqual([]);
    expect(detail.body.noMatchReason).toBeNull();

    const stray = await api.call("GET", "/transactions/ORD-TEST-2", { token: nadia });
    expect(stray.status).toBe(404);
    const noClick = (await api.call("GET", "/transactions?match=unmatched&pageSize=50", { token: nadia })).body.items.find((t: { orderRef: string }) => t.orderRef === "ORD-TEST-2");
    const noClickDetail = await api.call("GET", `/transactions/${noClick.id}`, { token: nadia });
    expect(noClickDetail.body.noMatchReason).toBe("no_sub_id");
    expect(noClickDetail.body.candidates.length).toBeGreaterThan(0);
    expect(noClickDetail.body.candidates[0].member.displayName).toBeTypeOf("string");
  });

  it("matches by hand, refuses a click outside the rules, and ignores with a reason", async () => {
    const noClick = (await api.call("GET", "/transactions?match=unmatched&pageSize=50", { token: nadia })).body.items.find((t: { orderRef: string }) => t.orderRef === "ORD-TEST-2");
    const detail = await api.call("GET", `/transactions/${noClick.id}`, { token: nadia });
    const candidate = detail.body.candidates.find((a: { id: string }) => a.id !== settledTonight && !api.seed.cashbacks.some((c) => c.activationId === a.id));
    expect((await api.call("POST", `/transactions/${noClick.id}/match`, { token: nadia, body: {} })).status).toBe(400);
    expect((await api.call("POST", `/transactions/${noClick.id}/match`, { token: nadia, body: { activationId: "act_nope" } })).status).toBe(404);
    const otherMerchant = api.seed.activations.find((a) => api.seed.offers.find((o) => o.id === a.offerId)!.merchantId !== noClick.merchantId)!;
    expect((await api.call("POST", `/transactions/${noClick.id}/match`, { token: nadia, body: { activationId: otherMerchant.id } })).status).toBe(422);
    const matched = await api.call("POST", `/transactions/${noClick.id}/match`, { token: nadia, body: { activationId: candidate.id } });
    expect(matched.status).toBe(200);
    expect(matched.body.matchStatus).toBe("matched");
    expect((await api.call("POST", `/transactions/${noClick.id}/ignore`, { token: nadia, body: { reason: "x" } })).status).toBe(409);

    const unmatched = api.seed.networkTransactions.find((t) => t.matchStatus === "unmatched")!;
    const ignored = await api.call("POST", `/transactions/${unmatched.id}/ignore`, { token: nadia, body: { reason: "not one of ours" } });
    expect(ignored.body).toMatchObject({ matchStatus: "ignored", ignoreReason: "not one of ours" });
    const audit = await api.call("GET", `/audit?entityType=transaction&entityId=${unmatched.id}`, { token: nadia });
    expect(audit.body.items[0]).toMatchObject({ action: "transaction.ignore", reason: "not one of ours" });
  });
});

describe("POST /claims/:id/credit", () => {
  it("credits a raised claim: a validated cashback, a manual credit in the wallet, the claim closed", async () => {
    // A raised claim whose click has no cashback yet and whose order the offer's rules accept.
    const claim = api.seed.claims.find((c) => {
      if (c.status !== "raised" || c.networkTransactionId !== null) return false;
      const click = api.seed.activations.filter((a) => a.userId === c.userId && a.offerId === c.offerId && a.activatedAt <= c.orderedAt).sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime())[0];
      const offer = api.seed.offers.find((o) => o.id === c.offerId)!;
      return click !== undefined && !api.seed.cashbacks.some((cb) => cb.activationId === click.id) && c.orderCents >= offer.minSpendCents && !offer.newCustomersOnly;
    })!;
    const before = await api.call("GET", `/users/${claim.userId}/wallet`, { token: sam });
    const res = await api.call("POST", `/claims/${claim.id}/credit`, { token: sam });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("credited");
    expect(res.body.cashbackId).toMatch(/^cb_/);
    const cashbacks = await api.call("GET", `/users/${claim.userId}/cashbacks?status=validated&pageSize=50`, { token: sam });
    const credited = cashbacks.body.items.find((c: { id: string }) => c.id === res.body.cashbackId);
    expect(credited).toMatchObject({ decidedBy: "claim", status: "validated", orderCents: claim.orderCents });
    const after = await api.call("GET", `/users/${claim.userId}/wallet`, { token: sam });
    expect(after.body.balances.available - before.body.balances.available).toBe(credited.amountCents);
    expect((await api.call("POST", `/claims/${claim.id}/credit`, { token: sam })).status).toBe(409);
  });

  it("refuses a claim that is not raised", async () => {
    const filed = api.seed.claims.find((c) => c.status === "filed")!;
    expect((await api.call("POST", `/claims/${filed.id}/credit`, { token: sam })).status).toBe(409);
  });
});

describe("GET /reports/reconciliation", () => {
  it("recomputes the book from the entries and finds the seed and tonight's work in balance", async () => {
    const res = await api.call("GET", "/reports/reconciliation", { token: nadia });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.map((c: { ok: boolean }) => c.ok)).toEqual([true, true]);
    expect(res.body.cashbacksOutOfBalance).toEqual([]);
    expect(res.body.payoutsOutOfBalance).toEqual([]);
    expect(res.body.negativeBalances).toEqual([]);
    expect(res.body.buckets.pending).toBe(res.body.cashbacks.pendingCents);
  });
});
