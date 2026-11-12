import { describe, expect, it } from "vitest";
import { addBoostBody, createOfferBody, declineClaimBody, fileClaimBody, listOffersQuery, marginQuery, requestPayoutBody, signUpBody } from "../src/index.js";

describe("the request schemas", () => {
  it("accept a sign-up and refuse a weak password with the same words as the domain rule", () => {
    expect(signUpBody.safeParse({ email: "a@b.co", password: "Strong-pass-1", displayName: "A" }).success).toBe(true);
    const bad = signUpBody.safeParse({ email: "a@b.co", password: "weak", displayName: "A" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.message)).toEqual(["password needs at least 10 characters, an upper-case letter, a digit"]);
    expect(signUpBody.safeParse({ email: "nope", password: "Strong-pass-1", displayName: "A" }).success).toBe(false);
  });

  it("read list queries from strings, with defaults and limits", () => {
    expect(listOffersQuery.parse({})).toEqual({ page: 1, pageSize: 20, sort: "rate" });
    expect(listOffersQuery.parse({ page: "3", pageSize: "10", q: "shoes", all: "1", kind: "voucher" })).toEqual({ page: 3, pageSize: 10, q: "shoes", all: true, kind: "voucher", sort: "rate" });
    expect(listOffersQuery.safeParse({ pageSize: "500" }).success).toBe(false);
    expect(listOffersQuery.safeParse({ sort: "price" }).success).toBe(false);
  });

  it("parse money as integer cents and dates as instants", () => {
    expect(requestPayoutBody.parse({ method: "transfer", amountCents: 2000, destination: "FR76 •••• 1234" }).amountCents).toBe(2000);
    expect(requestPayoutBody.safeParse({ method: "transfer", amountCents: 20.5, destination: "x" }).success).toBe(false);
    expect(requestPayoutBody.safeParse({ method: "cash", amountCents: 2000, destination: "x" }).success).toBe(false);
    const claim = fileClaimBody.parse({ offerId: "ofr_1", orderRef: "ORD-1", orderedAt: "2026-11-01T10:00:00Z", orderCents: 7990, proofText: "..." });
    expect(claim.orderedAt).toEqual(new Date("2026-11-01T10:00:00Z"));
    expect(fileClaimBody.safeParse({ offerId: "ofr_1", orderRef: "ORD-1", orderedAt: "yesterday", orderCents: 7990, proofText: "..." }).success).toBe(false);
    expect(marginQuery.parse({ from: "2026-10-01" }).from).toEqual(new Date("2026-10-01"));
  });

  it("keep the decline reasons to the fixed list", () => {
    expect(declineClaimBody.safeParse({ reason: "order_returned" }).success).toBe(true);
    expect(declineClaimBody.safeParse({ reason: "because" }).success).toBe(false);
  });

  it("fill an offer's defaults and refuse a boost that ends before it starts", () => {
    const o = createOfferBody.parse({ merchantId: "mer_1", kind: "online", title: "T", rateKind: "percent", rateBps: 500, validationDays: 30, startsAt: "2026-11-01T00:00:00Z" });
    expect(o).toMatchObject({ description: "", fixedCents: 0, minSpendCents: 0, newCustomersOnly: false, capCents: null, endsAt: null });
    expect(addBoostBody.safeParse({ rateBps: 900, startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }).success).toBe(false);
  });
});
