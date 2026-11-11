import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyRate, formatEuros, parseEuros, percentToBps } from "../src/money.js";

describe("applyRate", () => {
  it("takes a rate in basis points of an amount in cents", () => {
    expect(applyRate(10000, 420)).toBe(420); // 4.2 % of €100.00 is €4.20
    expect(applyRate(12990, 420)).toBe(546); // 545.58 rounds up
  });

  it("rounds halves up, which is what a member expects to see", () => {
    expect(applyRate(250, 100)).toBe(3); // 2.5 cents
    expect(applyRate(350, 100)).toBe(4);
    expect(applyRate(249, 100)).toBe(2);
  });

  it("is zero on a zero base and on a zero rate", () => {
    expect(applyRate(0, 420)).toBe(0);
    expect(applyRate(12990, 0)).toBe(0);
  });

  it("refuses a negative base, a negative rate and a rate above 100 %", () => {
    expect(() => applyRate(-1, 420)).toThrow();
    expect(() => applyRate(100, -1)).toThrow();
    expect(() => applyRate(100, 10001)).toThrow();
  });

  it("refuses amounts that are not whole cents", () => {
    expect(() => applyRate(12.5, 420)).toThrow();
    expect(() => applyRate(100, 4.2)).toThrow();
  });

  it("never exceeds the base and is monotonic in the base and in the rate", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000), (base, bps) => {
        const amount = applyRate(base, bps);
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(base);
        expect(applyRate(base + 1, bps)).toBeGreaterThanOrEqual(amount);
        expect(applyRate(base, Math.min(bps + 1, 10_000))).toBeGreaterThanOrEqual(amount);
      }),
    );
  });

  it("is within one cent of the exact value", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000), (base, bps) => {
        expect(Math.abs(applyRate(base, bps) - (base * bps) / 10_000)).toBeLessThanOrEqual(0.5);
      }),
    );
  });
});

describe("percentToBps", () => {
  it("turns a percentage with up to two decimals into basis points", () => {
    expect(percentToBps(4.2)).toBe(420);
    expect(percentToBps(10)).toBe(1000);
    expect(percentToBps(0.05)).toBe(5);
  });

  it("refuses more precision than a basis point, and anything outside 0..100", () => {
    expect(() => percentToBps(4.205)).toThrow();
    expect(() => percentToBps(100.5)).toThrow();
    expect(() => percentToBps(-1)).toThrow();
  });
});

describe("parseEuros", () => {
  it("reads an amount written with a point or a French comma", () => {
    expect(parseEuros("129.90")).toBe(12990);
    expect(parseEuros("129,90")).toBe(12990);
    expect(parseEuros("129")).toBe(12900);
    expect(parseEuros("0.5")).toBe(50);
    expect(parseEuros(" 12.34 ")).toBe(1234);
  });

  it("accepts a euro sign and a thousands separator", () => {
    expect(parseEuros("1 299,90 €")).toBe(129990);
    expect(parseEuros("€1,299.90")).toBe(129990);
  });

  it("returns null for anything else rather than guessing", () => {
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("12.345")).toBeNull();
    expect(parseEuros("-5")).toBeNull();
    expect(parseEuros("1e3")).toBeNull();
  });

  it("round-trips whatever formatEuros writes", () => {
    fc.assert(
      fc.property(fc.nat(100_000_000), (cents) => {
        expect(parseEuros(formatEuros(cents))).toBe(cents);
      }),
    );
  });
});

describe("formatEuros", () => {
  it("writes cents the French way", () => {
    expect(formatEuros(12990)).toBe("129,90 €");
    expect(formatEuros(5)).toBe("0,05 €");
    expect(formatEuros(0)).toBe("0,00 €");
    expect(formatEuros(129990)).toBe("1 299,90 €");
    expect(formatEuros(-250)).toBe("-2,50 €");
  });
});
