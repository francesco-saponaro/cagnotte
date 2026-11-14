import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyRate, computeCashback, type ComputeInput } from "../src/index.js";

/*
 * What a member gets for an order: the offer's rules at activation time, applied to the amount the
 * network reports, then held under the cap and under the commission the network pays.
 */

const percent = (extra: Partial<ComputeInput> = {}): ComputeInput => ({ rateKind: "percent", rateBps: 900, fixedCents: 0, minSpendCents: 0, capCents: null, newCustomersOnly: false, orderCents: 12990, commissionCents: 1559, alreadyCustomer: false, ...extra });

describe("computeCashback", () => {
  it("applies the activation's rate to the order, rounded half up", () => {
    expect(computeCashback(percent())).toEqual({ kind: "cashback", amountCents: 1169, marginClamped: false });
    expect(computeCashback(percent({ orderCents: 1005, rateBps: 500 }))).toEqual({ kind: "cashback", amountCents: 50, marginClamped: false });
  });

  it("pays a fixed offer its amount whatever the order", () => {
    expect(computeCashback(percent({ rateKind: "fixed", rateBps: 0, fixedCents: 2000, orderCents: 500, commissionCents: 3500 }))).toEqual({ kind: "cashback", amountCents: 2000, marginClamped: false });
  });

  it("ignores an order under the minimum spend, before anything else", () => {
    expect(computeCashback(percent({ minSpendCents: 15000 }))).toEqual({ kind: "ignored", reason: "below_minimum" });
    expect(computeCashback(percent({ minSpendCents: 12990 })).kind).toBe("cashback");
  });

  it("ignores a returning customer on a new-customers-only offer", () => {
    expect(computeCashback(percent({ newCustomersOnly: true, alreadyCustomer: true }))).toEqual({ kind: "ignored", reason: "not_new_customer" });
    expect(computeCashback(percent({ newCustomersOnly: false, alreadyCustomer: true })).kind).toBe("cashback");
  });

  it("holds the amount under the cap, then under the commission, and says when the commission bit", () => {
    expect(computeCashback(percent({ capCents: 1000 }))).toEqual({ kind: "cashback", amountCents: 1000, marginClamped: false });
    expect(computeCashback(percent({ commissionCents: 800 }))).toEqual({ kind: "cashback", amountCents: 800, marginClamped: true });
    expect(computeCashback(percent({ capCents: 1000, commissionCents: 1000 }))).toEqual({ kind: "cashback", amountCents: 1000, marginClamped: false });
    expect(computeCashback(percent({ commissionCents: null }))).toEqual({ kind: "cashback", amountCents: 1169, marginClamped: false });
  });

  it("never books a zero cashback: no commission, or a rate that rounds to nothing", () => {
    expect(computeCashback(percent({ commissionCents: 0 }))).toEqual({ kind: "ignored", reason: "no_commission" });
    expect(computeCashback(percent({ orderCents: 4, rateBps: 100 }))).toEqual({ kind: "ignored", reason: "zero_amount" });
  });

  it("keeps every amount within the base, the cap and the commission, and clamps exactly when the commission is the smallest", () => {
    const arb = fc.record({
      rateBps: fc.integer({ min: 0, max: 10000 }),
      orderCents: fc.integer({ min: 0, max: 5_000_000 }),
      commissionCents: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
      capCents: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
      minSpendCents: fc.integer({ min: 0, max: 50_000 }),
    });
    fc.assert(
      fc.property(arb, (p) => {
        const result = computeCashback(percent(p));
        if (p.orderCents < p.minSpendCents) return result.kind === "ignored" && result.reason === "below_minimum";
        const raw = applyRate(p.orderCents, p.rateBps);
        const capped = p.capCents === null ? raw : Math.min(raw, p.capCents);
        const expected = p.commissionCents === null ? capped : Math.min(capped, p.commissionCents);
        if (expected === 0) return result.kind === "ignored";
        if (result.kind !== "cashback") return false;
        return result.amountCents === expected && result.amountCents <= p.orderCents && result.marginClamped === (p.commissionCents !== null && p.commissionCents < capped);
      }),
    );
  });

  it("never pays less for a bigger order", () => {
    const arb = fc.record({ rateBps: fc.integer({ min: 1, max: 10000 }), a: fc.integer({ min: 0, max: 1_000_000 }), b: fc.integer({ min: 0, max: 1_000_000 }), commissionCents: fc.integer({ min: 1, max: 100_000 }), capCents: fc.option(fc.integer({ min: 1, max: 50_000 }), { nil: null }) });
    const amount = (input: ComputeInput) => {
      const r = computeCashback(input);
      return r.kind === "cashback" ? r.amountCents : 0;
    };
    fc.assert(
      fc.property(arb, (p) => {
        const [small, big] = p.a <= p.b ? [p.a, p.b] : [p.b, p.a];
        return amount(percent({ ...p, orderCents: small })) <= amount(percent({ ...p, orderCents: big }));
      }),
    );
  });
});
