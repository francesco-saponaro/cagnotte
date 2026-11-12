import { describe, expect, it } from "vitest";
import { batchTransitions, cashbackTransitions, claimTransitions, matchTransitions, move, offerTransitions, payoutTransitions, referralTransitions } from "../src/index.js";

describe("the transition tables", () => {
  it("let an offer go draft → live → paused → live → ended and nowhere else", () => {
    expect(offerTransitions.draft).toEqual(["live"]);
    expect(offerTransitions.live).toEqual(["paused", "ended"]);
    expect(offerTransitions.paused).toEqual(["live", "ended"]);
    expect(offerTransitions.ended).toEqual([]);
  });

  it("let a cashback leave pending once, and a validated one only be cancelled", () => {
    expect(cashbackTransitions.pending).toEqual(["validated", "refused", "cancelled"]);
    expect(cashbackTransitions.validated).toEqual(["cancelled"]);
    expect(cashbackTransitions.refused).toEqual([]);
    expect(cashbackTransitions.cancelled).toEqual([]);
  });

  it("let an ignored transaction be revived by a claim but never un-match a matched one", () => {
    expect(matchTransitions.unmatched).toEqual(["matched", "ignored"]);
    expect(matchTransitions.ignored).toEqual(["matched"]);
    expect(matchTransitions.matched).toEqual([]);
  });

  it("walk a claim filed → acknowledged → raised → credited, with decline possible until then", () => {
    expect(claimTransitions.filed).toEqual(["acknowledged", "declined"]);
    expect(claimTransitions.acknowledged).toEqual(["raised", "declined"]);
    expect(claimTransitions.raised).toEqual(["credited", "declined"]);
    expect(claimTransitions.credited).toEqual([]);
    expect(claimTransitions.declined).toEqual([]);
  });

  it("walk a payout requested → checking → sent, failing from either open state", () => {
    expect(payoutTransitions.requested).toEqual(["checking", "failed"]);
    expect(payoutTransitions.checking).toEqual(["sent", "failed"]);
    expect(payoutTransitions.sent).toEqual([]);
    expect(payoutTransitions.failed).toEqual([]);
  });

  it("end a referral and a batch after one step", () => {
    expect(referralTransitions.pending).toEqual(["validated", "expired"]);
    expect(referralTransitions.validated).toEqual([]);
    expect(batchTransitions.received).toEqual(["processed", "failed"]);
    expect(batchTransitions.processed).toEqual([]);
  });
});

describe("move", () => {
  it("returns the new state for an allowed transition", () => {
    expect(move(claimTransitions, "claim", "filed", "acknowledged")).toEqual({ ok: true, value: "acknowledged" });
  });

  it("returns a conflict naming both states for a forbidden one", () => {
    const result = move(payoutTransitions, "payout", "sent", "failed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
      expect(result.error.message).toBe("a payout cannot go from sent to failed");
    }
  });

  it("treats staying in the same state as forbidden too", () => {
    expect(move(offerTransitions, "offer", "live", "live").ok).toBe(false);
  });
});
