import { describe, expect, it } from "vitest";
import type { NetworkTransaction } from "../src/index.js";
import { AGENT, MANAGER, MEMBER, NOW, OTHER, activation, cashback, daysAgo, entry, errorOf, unwrap, user, world } from "./harness.js";

const claimWorld = () => world({ activations: [activation("act_1", "usr_member", "ofr_live", daysAgo(40)), activation("act_2", "usr_other", "ofr_fixed", daysAgo(10))] });

const input = { offerId: "ofr_live", orderRef: "ORD-ABC123", orderedAt: daysAgo(39), orderCents: 7990, proofText: "Order confirmation ORD-ABC123 ..." };

describe("fileClaim", () => {
  it("files a claim against the member's activation before the order, and audits it", async () => {
    const w = claimWorld();
    const c = unwrap(await w.fileClaim(MEMBER, input));
    expect(c.status).toBe("filed");
    expect(c.filedAt).toEqual(NOW);
    expect(c.userId).toBe("usr_member");
    expect(c.orderRef).toBe("ORD-ABC123");
    expect(unwrap(await w.listAudit(MANAGER, { entityId: c.id })).items.map((a) => a.action)).toEqual(["claim.file"]);
  });

  it("refuses a claim without an activation of that offer before the order", async () => {
    const w = claimWorld();
    expect(errorOf(await w.fileClaim(OTHER, input)).message).toMatch(/activat/);
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, orderedAt: daysAgo(41) })).code).toBe("rule");
  });

  it("refuses an order older than three months for an online offer, or in the future", async () => {
    const w = world({ activations: [activation("act_1", "usr_member", "ofr_live", daysAgo(200))] });
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, orderedAt: daysAgo(95) })).message).toMatch(/three months/);
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, orderedAt: daysAgo(-1) })).code).toBe("invalid");
    expect(unwrap(await w.fileClaim(MEMBER, { ...input, orderedAt: daysAgo(89) })).status).toBe("filed");
  });

  it("refuses a draft offer, a blank reference and an empty proof", async () => {
    const w = claimWorld();
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, offerId: "ofr_draft" })).code).toBe("not_found");
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, orderRef: " " })).code).toBe("invalid");
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, proofText: "" })).code).toBe("invalid");
    expect(errorOf(await w.fileClaim(MEMBER, { ...input, orderCents: -1 })).code).toBe("invalid");
  });
});

describe("the claims queue", () => {
  async function filed() {
    const w = claimWorld();
    const mine = unwrap(await w.fileClaim(MEMBER, input));
    const theirs = unwrap(await w.fileClaim(OTHER, { ...input, offerId: "ofr_fixed", orderRef: "ORD-OTHER", orderedAt: daysAgo(9) }));
    return { w, mine, theirs };
  }

  it("shows a member only their own claims, and staff the queue with filters", async () => {
    const { w, mine, theirs } = await filed();
    expect(unwrap(await w.listClaims(MEMBER, {})).items.map((c) => c.id)).toEqual([mine.id]);
    expect(unwrap(await w.listClaims(AGENT, {})).total).toBe(2);
    expect(unwrap(await w.listClaims(AGENT, { q: "other" })).items.map((c) => c.id)).toEqual([theirs.id]);
    expect(unwrap(await w.getClaim(MEMBER, mine.id)).member.email).toBe("member@example.com");
    expect(errorOf(await w.getClaim(MEMBER, theirs.id)).code).toBe("forbidden");
    expect(unwrap(await w.getClaim(AGENT, theirs.id)).offer.merchant.name).toBe("Shop mer_b");
  });

  it("walks filed → acknowledged → raised, assigning the agent who acknowledges", async () => {
    const { w, mine } = await filed();
    const ack = unwrap(await w.acknowledgeClaim(AGENT, mine.id));
    expect(ack.status).toBe("acknowledged");
    expect(ack.assigneeId).toBe("usr_agent");
    expect(ack.updatedAt).toEqual(NOW);
    const raised = unwrap(await w.raiseClaim(AGENT, mine.id, {}));
    expect(raised.status).toBe("raised");
    expect(errorOf(await w.acknowledgeClaim(AGENT, mine.id)).code).toBe("conflict");
    expect(unwrap(await w.listAudit(MANAGER, { entityId: mine.id })).items.map((a) => a.action)).toEqual(["claim.raise", "claim.acknowledge", "claim.file"]);
  });

  it("assigns a claim to an agent and only to an agent", async () => {
    const { w, mine } = await filed();
    expect(unwrap(await w.assignClaim(AGENT, mine.id, { assigneeId: "usr_manager" })).assigneeId).toBe("usr_manager");
    expect(errorOf(await w.assignClaim(AGENT, mine.id, { assigneeId: "usr_other" })).code).toBe("rule");
    expect(errorOf(await w.assignClaim(AGENT, mine.id, { assigneeId: "usr_nobody" })).code).toBe("not_found");
    expect(errorOf(await w.assignClaim(MEMBER, mine.id, { assigneeId: "usr_agent" })).code).toBe("forbidden");
  });

  it("links an unmatched transaction of the same merchant when raising", async () => {
    const tx = (id: string, merchantId: string, matchStatus: NetworkTransaction["matchStatus"]): NetworkTransaction => ({ id, batchId: "imp_1", network: "linkpool", networkRef: id, subId: null, orderRef: "ORD-ABC123", merchantId, orderedAt: daysAgo(39), orderCents: 7990, commissionCents: 900, networkStatus: "pending", reportedAt: daysAgo(38), matchStatus, activationId: null, ignoreReason: null });
    const w = world({ activations: [activation("act_1", "usr_member", "ofr_live", daysAgo(40))], transactions: [tx("ntx_same", "mer_a", "unmatched"), tx("ntx_otherm", "mer_b", "unmatched"), tx("ntx_matched", "mer_a", "matched")] });
    const c = unwrap(await w.fileClaim(MEMBER, input));
    unwrap(await w.acknowledgeClaim(AGENT, c.id));
    expect(errorOf(await w.raiseClaim(AGENT, c.id, { networkTransactionId: "ntx_otherm" })).code).toBe("rule");
    expect(errorOf(await w.raiseClaim(AGENT, c.id, { networkTransactionId: "ntx_matched" })).code).toBe("rule");
    expect(errorOf(await w.raiseClaim(AGENT, c.id, { networkTransactionId: "ntx_nope" })).code).toBe("not_found");
    expect(unwrap(await w.raiseClaim(AGENT, c.id, { networkTransactionId: "ntx_same" })).networkTransactionId).toBe("ntx_same");
  });

  it("declines from filed, acknowledged or raised with a reason from the list, never twice", async () => {
    const { w, mine, theirs } = await filed();
    const declined = unwrap(await w.declineClaim(AGENT, mine.id, { reason: "foreign_promo_code" }));
    expect(declined.status).toBe("declined");
    expect(declined.declineReason).toBe("foreign_promo_code");
    expect(errorOf(await w.declineClaim(AGENT, mine.id, { reason: "foreign_promo_code" })).code).toBe("conflict");
    expect(errorOf(await w.declineClaim(AGENT, theirs.id, { reason: "because" as never })).code).toBe("invalid");
    unwrap(await w.acknowledgeClaim(AGENT, theirs.id));
    unwrap(await w.raiseClaim(AGENT, theirs.id, {}));
    expect(unwrap(await w.declineClaim(MANAGER, theirs.id, { reason: "order_returned" })).status).toBe("declined");
  });

  it("keeps members out of the transitions", async () => {
    const { w, mine } = await filed();
    expect(errorOf(await w.acknowledgeClaim(MEMBER, mine.id)).code).toBe("forbidden");
    expect(errorOf(await w.raiseClaim(MEMBER, mine.id, {})).code).toBe("forbidden");
    expect(errorOf(await w.declineClaim(MEMBER, mine.id, { reason: "order_returned" })).code).toBe("forbidden");
    expect(errorOf(await w.acknowledgeClaim(AGENT, "clm_nope")).code).toBe("not_found");
  });
});

describe("referrals", () => {
  it("shows the member's code, referees and bonuses", async () => {
    const w = world({
      users: [user("usr_ref1", "member", { referredBy: "usr_member", displayName: "Lina", createdAt: daysAgo(30) }), user("usr_ref2", "member", { referredBy: "usr_member", displayName: "Noah", createdAt: daysAgo(5) })],
      referrals: [
        { id: "ref_1", referrerId: "usr_member", refereeId: "usr_ref1", code: "member", status: "validated", createdAt: daysAgo(30), expiresAt: null, validatedAt: daysAgo(10), bonusUntil: daysAgo(-355) },
        { id: "ref_2", referrerId: "usr_member", refereeId: "usr_ref2", code: "member", status: "pending", createdAt: daysAgo(5), expiresAt: daysAgo(-85), validatedAt: null, bonusUntil: null },
      ],
      ledgerEntries: [entry("led_1", "usr_member", "available", 2000, { kind: "referral_bonus", refType: "referral", refId: "ref_1", createdAt: daysAgo(10) }), entry("led_2", "usr_member", "available", 120, { kind: "referral_bonus", refType: "referral", refId: "ref_1", createdAt: daysAgo(3) }), entry("led_3", "usr_member", "available", 500, { createdAt: daysAgo(3) })],
      cashbacks: [cashback("cb_1", "usr_member", "ofr_live")],
    });
    const r = unwrap(await w.getReferrals(MEMBER));
    expect(r.code).toBe("member");
    expect(r.referees.map((x) => [x.displayName, x.status])).toEqual([
      ["Noah", "pending"],
      ["Lina", "validated"],
    ]);
    expect(r.bonusCents).toBe(2120);
    expect(r.remaining).toBe(18);
  });
});
