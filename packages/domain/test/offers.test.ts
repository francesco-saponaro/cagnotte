import { describe, expect, it } from "vitest";
import { AGENT, MANAGER, MEMBER, NOW, OTHER, activation, cashback, daysAgo, entry, errorOf, offer, unwrap, world } from "./harness.js";

describe("listOffers", () => {
  it("shows a member live offers only, sorted by rate by default, with the merchant", async () => {
    const page = unwrap(await world().listOffers(MEMBER, {}));
    expect(page.items.map((o) => o.id)).toEqual(["ofr_live", "ofr_fixed"]);
    expect(page.items[0]?.merchant.name).toBe("Shop mer_a");
    expect(page.total).toBe(2);
    expect(page.pageSize).toBe(20);
  });

  it("shows a manager every status when asked, and never a member", async () => {
    const w = world();
    expect(unwrap(await w.listOffers(MANAGER, { all: true, sort: "name" })).items.map((o) => o.id)).toEqual(["ofr_draft", "ofr_fixed", "ofr_live", "ofr_paused"]);
    expect(unwrap(await w.listOffers(MEMBER, { all: true })).total).toBe(2);
    expect(unwrap(await w.listOffers(AGENT, { all: true })).total).toBe(2);
  });

  it("filters by text, category and kind and clamps the page size", async () => {
    const w = world();
    expect(unwrap(await w.listOffers(MEMBER, { q: "mer_b" })).items.map((o) => o.id)).toEqual(["ofr_fixed"]);
    expect(unwrap(await w.listOffers(MEMBER, { category: "fashion" })).items.map((o) => o.id)).toEqual(["ofr_live"]);
    expect(unwrap(await w.listOffers(MEMBER, { pageSize: 500 })).pageSize).toBe(50);
  });
});

describe("getOffer", () => {
  it("returns the offer with its boosts and the rate in force now", async () => {
    const w = world({ offerBoosts: [{ id: "bst_1", offerId: "ofr_live", rateBps: 900, startsAt: daysAgo(1), endsAt: daysAgo(-1), createdBy: "usr_manager" }] });
    const o = unwrap(await w.getOffer(MEMBER, "ofr_live"));
    expect(o.rateInForce).toEqual({ rateBps: 900, boosted: true });
    expect(o.boosts.map((b) => b.id)).toEqual(["bst_1"]);
  });

  it("hides a draft or paused offer from a member but not from a manager", async () => {
    const w = world();
    expect(errorOf(await w.getOffer(MEMBER, "ofr_draft")).code).toBe("not_found");
    expect(errorOf(await w.getOffer(MEMBER, "ofr_paused")).code).toBe("not_found");
    expect(unwrap(await w.getOffer(MANAGER, "ofr_draft")).id).toBe("ofr_draft");
    expect(errorOf(await w.getOffer(MANAGER, "ofr_nope")).code).toBe("not_found");
  });
});

describe("activateOffer", () => {
  it("records the rate in force, a 16-character subId and the tracking link", async () => {
    const w = world({ offerBoosts: [{ id: "bst_1", offerId: "ofr_live", rateBps: 900, startsAt: daysAgo(1), endsAt: daysAgo(-1), createdBy: "usr_manager" }] });
    const a = unwrap(await w.activateOffer(MEMBER, "ofr_live"));
    expect(a.userId).toBe("usr_member");
    expect(a.rateBps).toBe(900);
    expect(a.boosted).toBe(true);
    expect(a.subId).toMatch(/^[a-z0-9]{16}$/);
    expect(a.trackingUrl).toBe(`https://track.linkpool.example/go?adv=LP-mer_a&sub=${a.subId}`);
    expect(a.activatedAt).toEqual(NOW);
    expect(w.store.activations).toHaveLength(1);
  });

  it("refuses an offer that is not live or not yet started or already over", async () => {
    const w = world({ offers: [offer("ofr_future", "mer_a", { startsAt: daysAgo(-5) }), offer("ofr_over", "mer_a", { endsAt: daysAgo(1) })] });
    expect(errorOf(await w.activateOffer(MEMBER, "ofr_paused")).code).toBe("rule");
    expect(errorOf(await w.activateOffer(MEMBER, "ofr_draft")).code).toBe("rule");
    expect(errorOf(await w.activateOffer(MEMBER, "ofr_future")).code).toBe("rule");
    expect(errorOf(await w.activateOffer(MEMBER, "ofr_over")).code).toBe("rule");
    expect(errorOf(await w.activateOffer(MEMBER, "ofr_nope")).code).toBe("not_found");
  });

  it("lists a member's own activations, newest first", async () => {
    const w = world({ activations: [activation("act_1", "usr_member", "ofr_live", daysAgo(3)), activation("act_2", "usr_member", "ofr_fixed", daysAgo(1)), activation("act_3", "usr_other", "ofr_live", daysAgo(1))] });
    const page = unwrap(await w.listActivations(MEMBER, {}));
    expect(page.items.map((a) => a.id)).toEqual(["act_2", "act_1"]);
    expect(page.items[0]?.offer.title).toBe("Offer ofr_fixed");
  });
});

describe("the wallet", () => {
  const ledger = [entry("led_1", "usr_member", "pending", 500, { kind: "cashback_pending", createdAt: daysAgo(20) }), entry("led_2", "usr_member", "available", 1200, { createdAt: daysAgo(10) }), entry("led_3", "usr_other", "available", 99)];

  it("sums the buckets and pages the ledger newest first", async () => {
    const w = world({ ledgerEntries: ledger });
    const wallet = unwrap(await w.getWallet(MEMBER, {}));
    expect(wallet.balances).toEqual({ pending: 500, available: 1200, reserved: 0, paid: 0 });
    expect(wallet.ledger.items.map((e) => e.id)).toEqual(["led_2", "led_1"]);
  });

  it("lets an agent read another member's wallet but not a member", async () => {
    const w = world({ ledgerEntries: ledger });
    expect(unwrap(await w.getWalletOf(AGENT, "usr_other", {})).balances.available).toBe(99);
    expect(errorOf(await w.getWalletOf(OTHER, "usr_member", {})).code).toBe("forbidden");
    expect(errorOf(await w.getWalletOf(AGENT, "usr_nobody", {})).code).toBe("not_found");
  });
});

describe("cashbacks", () => {
  const cashbacks = [cashback("cb_1", "usr_member", "ofr_live", { createdAt: daysAgo(5) }), cashback("cb_2", "usr_member", "ofr_fixed", { status: "validated", createdAt: daysAgo(3) }), cashback("cb_3", "usr_other", "ofr_live")];

  it("lists a member's own cashbacks, filtered by status", async () => {
    const w = world({ cashbacks });
    expect(unwrap(await w.listCashbacks(MEMBER, {})).items.map((c) => c.id)).toEqual(["cb_2", "cb_1"]);
    expect(unwrap(await w.listCashbacks(MEMBER, { status: "pending" })).items.map((c) => c.id)).toEqual(["cb_1"]);
  });

  it("shows a cashback with its offer and ledger entries to its owner or to staff", async () => {
    const w = world({ cashbacks, ledgerEntries: [entry("led_1", "usr_member", "pending", 500, { refId: "cb_1", kind: "cashback_pending" })] });
    const c = unwrap(await w.getCashback(MEMBER, "cb_1"));
    expect(c.offer.merchant.name).toBe("Shop mer_a");
    expect(c.entries.map((e) => e.id)).toEqual(["led_1"]);
    expect(unwrap(await w.getCashback(AGENT, "cb_1")).id).toBe("cb_1");
    expect(errorOf(await w.getCashback(OTHER, "cb_1")).code).toBe("forbidden");
    expect(errorOf(await w.getCashback(MEMBER, "cb_nope")).code).toBe("not_found");
  });

  it("lets an agent list another member's cashbacks", async () => {
    const w = world({ cashbacks });
    expect(unwrap(await w.listCashbacksOf(AGENT, "usr_other", {})).items.map((c) => c.id)).toEqual(["cb_3"]);
    expect(errorOf(await w.listCashbacksOf(MEMBER, "usr_other", {})).code).toBe("forbidden");
  });
});
