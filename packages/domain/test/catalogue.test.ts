import { describe, expect, it } from "vitest";
import type { NetworkTransaction } from "../src/index.js";
import { AGENT, MANAGER, MEMBER, NOW, cashback, daysAgo, errorOf, unwrap, world } from "./harness.js";

describe("merchants", () => {
  it("lists merchants for staff and creates one with a unique slug", async () => {
    const w = world();
    expect(unwrap(await w.listMerchants(AGENT)).map((m) => m.id)).toEqual(["mer_a", "mer_b"]);
    expect(errorOf(await w.listMerchants(MEMBER)).code).toBe("forbidden");
    const m = unwrap(await w.createMerchant(MANAGER, { slug: "Nouveau-Shop", name: "Nouveau Shop", category: "home", country: "FR", attributionDays: 14, network: "affinet", advertiserRef: "AF-9" }));
    expect(m.slug).toBe("nouveau-shop");
    expect(errorOf(await w.createMerchant(MANAGER, { slug: "mer-a", name: "Dup", category: "home", country: "FR", attributionDays: 14, network: "affinet", advertiserRef: "AF-10" })).code).toBe("conflict");
    expect(errorOf(await w.createMerchant(MANAGER, { slug: "x", name: "", category: "home", country: "FR", attributionDays: 14, network: "affinet", advertiserRef: "AF-11" })).code).toBe("invalid");
    expect(errorOf(await w.createMerchant(MANAGER, { slug: "y", name: "Y", category: "home", country: "FR", attributionDays: 0, network: "affinet", advertiserRef: "AF-12" })).code).toBe("invalid");
    expect(errorOf(await w.createMerchant(AGENT, { slug: "z", name: "Z", category: "home", country: "FR", attributionDays: 1, network: "affinet", advertiserRef: "AF-13" })).code).toBe("forbidden");
  });
});

describe("offers in the back office", () => {
  const percent = { merchantId: "mer_a", kind: "online" as const, title: "Shop A: 7 % back", description: "", rateKind: "percent" as const, rateBps: 700, fixedCents: 0, minSpendCents: 0, newCustomersOnly: false, capCents: null, validationDays: 45, startsAt: daysAgo(1), endsAt: null };

  it("creates a draft offer and audits it", async () => {
    const w = world();
    const o = unwrap(await w.createOffer(MANAGER, percent));
    expect(o.status).toBe("draft");
    expect(o.createdAt).toEqual(NOW);
    expect(unwrap(await w.listAudit(MANAGER, { entityId: o.id })).items.map((a) => a.action)).toEqual(["offer.create"]);
  });

  it("checks the rate against its kind, the window and the merchant", async () => {
    const w = world();
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, fixedCents: 500 })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, rateKind: "fixed", rateBps: 0, fixedCents: 0 })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, rateBps: 10001 })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, endsAt: daysAgo(2) })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, validationDays: 0 })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, capCents: 0 })).code).toBe("invalid");
    expect(errorOf(await w.createOffer(MANAGER, { ...percent, merchantId: "mer_nope" })).code).toBe("not_found");
    expect(errorOf(await w.createOffer(AGENT, percent)).code).toBe("forbidden");
  });

  it("updates an offer's words and rate but never an ended one", async () => {
    const w = world();
    const o = unwrap(await w.updateOffer(MANAGER, "ofr_live", { title: "Shop A: 8 % back", rateBps: 800 }));
    expect(o.title).toBe("Shop A: 8 % back");
    expect(o.rateBps).toBe(800);
    expect(o.updatedAt).toEqual(NOW);
    unwrap(await w.endOffer(MANAGER, "ofr_live"));
    expect(errorOf(await w.updateOffer(MANAGER, "ofr_live", { title: "x" })).code).toBe("conflict");
    expect(errorOf(await w.updateOffer(MANAGER, "ofr_fixed", { rateBps: 100 })).code).toBe("invalid");
  });

  it("walks draft → live → paused → live → ended with the table", async () => {
    const w = world();
    expect(unwrap(await w.publishOffer(MANAGER, "ofr_draft")).status).toBe("live");
    expect(errorOf(await w.publishOffer(MANAGER, "ofr_draft")).code).toBe("conflict");
    expect(unwrap(await w.pauseOffer(MANAGER, "ofr_draft")).status).toBe("paused");
    expect(unwrap(await w.resumeOffer(MANAGER, "ofr_draft")).status).toBe("live");
    const ended = unwrap(await w.endOffer(MANAGER, "ofr_draft"));
    expect(ended.status).toBe("ended");
    expect(ended.endsAt).toEqual(NOW);
    expect(errorOf(await w.resumeOffer(MANAGER, "ofr_draft")).code).toBe("conflict");
    expect(errorOf(await w.pauseOffer(AGENT, "ofr_live")).code).toBe("forbidden");
    expect(unwrap(await w.listAudit(MANAGER, { entityId: "ofr_draft" })).items.map((a) => a.action)).toEqual(["offer.end", "offer.resume", "offer.pause", "offer.publish"]);
  });

  it("adds a boost to a live percent offer when the window is free and the rate is higher", async () => {
    const w = world();
    const b = unwrap(await w.addBoost(MANAGER, "ofr_live", { rateBps: 900, startsAt: daysAgo(-1), endsAt: daysAgo(-8) }));
    expect(b.createdBy).toBe("usr_manager");
    expect(errorOf(await w.addBoost(MANAGER, "ofr_live", { rateBps: 1000, startsAt: daysAgo(-7), endsAt: daysAgo(-9) })).code).toBe("conflict");
    expect(unwrap(await w.addBoost(MANAGER, "ofr_live", { rateBps: 1000, startsAt: daysAgo(-8), endsAt: daysAgo(-9) })).rateBps).toBe(1000);
    expect(errorOf(await w.addBoost(MANAGER, "ofr_live", { rateBps: 500, startsAt: daysAgo(-20), endsAt: daysAgo(-21) })).code).toBe("rule");
    expect(errorOf(await w.addBoost(MANAGER, "ofr_live", { rateBps: 900, startsAt: daysAgo(-21), endsAt: daysAgo(-21) })).code).toBe("invalid");
    expect(errorOf(await w.addBoost(MANAGER, "ofr_fixed", { rateBps: 900, startsAt: daysAgo(-20), endsAt: daysAgo(-21) })).code).toBe("rule");
    expect(errorOf(await w.addBoost(MANAGER, "ofr_paused", { rateBps: 1200, startsAt: daysAgo(-20), endsAt: daysAgo(-21) })).code).toBe("rule");
    expect(unwrap(await w.getOffer(MANAGER, "ofr_live")).boosts).toHaveLength(2);
  });
});

describe("reports", () => {
  const tx = (id: string, merchantId: string, orderedAt: Date, orderCents: number, commissionCents: number): NetworkTransaction => ({ id, batchId: "imp_1", network: "linkpool", networkRef: id, subId: null, orderRef: id, merchantId, orderedAt, orderCents, commissionCents, networkStatus: "approved", reportedAt: orderedAt, matchStatus: "matched", activationId: null, ignoreReason: null });

  it("gives the overview counts and sums", async () => {
    const w = world({
      cashbacks: [cashback("cb_1", "usr_member", "ofr_live", { amountCents: 800 }), cashback("cb_2", "usr_member", "ofr_live", { amountCents: 300, status: "validated", validatedAt: daysAgo(3) }), cashback("cb_3", "usr_other", "ofr_live", { amountCents: 900, status: "validated", validatedAt: daysAgo(40) })],
      transactions: [tx("ntx_1", "mer_a", daysAgo(3), 10000, 900), { ...tx("ntx_2", "mer_b", daysAgo(4), 5000, 200), matchStatus: "unmatched" }],
    });
    const o = unwrap(await w.getOverview(MANAGER));
    expect(o).toEqual({
      members: 2,
      liveOffers: 2,
      pendingCashbacks: { count: 1, cents: 800 },
      validatedCents: 1200,
      validatedLast30DaysCents: 300,
      unmatchedTransactions: 1,
      openClaims: 0,
      payoutsWaiting: 0,
    });
    expect(errorOf(await w.getOverview(AGENT)).code).toBe("forbidden");
  });

  it("gives the margin by merchant in a window: commission in, cashback out", async () => {
    const w = world({
      cashbacks: [cashback("cb_1", "usr_member", "ofr_live", { amountCents: 600, networkTransactionId: "ntx_1" }), cashback("cb_2", "usr_other", "ofr_fixed", { amountCents: 1000, networkTransactionId: "ntx_2", status: "refused" })],
      transactions: [tx("ntx_1", "mer_a", daysAgo(3), 10000, 900), tx("ntx_2", "mer_b", daysAgo(4), 5000, 1200), tx("ntx_3", "mer_a", daysAgo(40), 8000, 500)],
    });
    const r = unwrap(await w.getMargin(MANAGER, { from: daysAgo(10), to: NOW }));
    expect(r.lines).toEqual([
      { merchantId: "mer_b", merchantName: "Shop mer_b", transactions: 1, orderCents: 5000, commissionCents: 1200, cashbackCents: 0, marginCents: 1200 },
      { merchantId: "mer_a", merchantName: "Shop mer_a", transactions: 1, orderCents: 10000, commissionCents: 900, cashbackCents: 600, marginCents: 300 },
    ]);
    expect(r.totals).toEqual({ transactions: 2, orderCents: 15000, commissionCents: 2100, cashbackCents: 600, marginCents: 1500 });
    expect(errorOf(await w.getMargin(MANAGER, { from: NOW, to: daysAgo(1) })).code).toBe("invalid");
  });
});
