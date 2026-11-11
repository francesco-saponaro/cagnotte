import { describe, expect, it } from "vitest";
import { boostsOverlap, rateInForce, type Boost } from "../src/rate.js";

const t = (s: string) => new Date(s);

const boosts: Boost[] = [
  { rateBps: 800, startsAt: t("2026-11-01T00:00:00Z"), endsAt: t("2026-11-03T00:00:00Z") },
  { rateBps: 1200, startsAt: t("2026-11-20T00:00:00Z"), endsAt: t("2026-11-27T00:00:00Z") },
];

describe("rateInForce", () => {
  it("is the base rate when no boost covers the instant", () => {
    expect(rateInForce(420, boosts, t("2026-11-10T12:00:00Z"))).toEqual({ rateBps: 420, boosted: false });
    expect(rateInForce(420, [], t("2026-11-10T12:00:00Z"))).toEqual({ rateBps: 420, boosted: false });
  });

  it("is the boost's rate inside its window", () => {
    expect(rateInForce(420, boosts, t("2026-11-02T12:00:00Z"))).toEqual({ rateBps: 800, boosted: true });
    expect(rateInForce(420, boosts, t("2026-11-25T00:00:00Z"))).toEqual({ rateBps: 1200, boosted: true });
  });

  it("includes the start and excludes the end of a window", () => {
    expect(rateInForce(420, boosts, t("2026-11-01T00:00:00Z")).rateBps).toBe(800);
    expect(rateInForce(420, boosts, t("2026-11-03T00:00:00Z")).rateBps).toBe(420);
  });

  it("never lowers the rate: a boost below the base rate is ignored", () => {
    const low: Boost[] = [{ rateBps: 100, startsAt: t("2026-11-01T00:00:00Z"), endsAt: t("2026-12-01T00:00:00Z") }];
    expect(rateInForce(420, low, t("2026-11-10T00:00:00Z"))).toEqual({ rateBps: 420, boosted: false });
  });
});

describe("boostsOverlap", () => {
  it("is false for a window that touches an existing one without overlapping", () => {
    expect(boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-11-03T00:00:00Z"), endsAt: t("2026-11-05T00:00:00Z") })).toBe(false);
    expect(boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-11-27T00:00:00Z"), endsAt: t("2026-11-30T00:00:00Z") })).toBe(false);
  });

  it("is true when any part of the window is already boosted", () => {
    expect(boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-11-02T00:00:00Z"), endsAt: t("2026-11-05T00:00:00Z") })).toBe(true);
    expect(boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-10-01T00:00:00Z"), endsAt: t("2026-12-31T00:00:00Z") })).toBe(true);
    expect(boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-11-21T00:00:00Z"), endsAt: t("2026-11-22T00:00:00Z") })).toBe(true);
  });

  it("refuses a window that does not end after it starts", () => {
    expect(() => boostsOverlap(boosts, { rateBps: 900, startsAt: t("2026-11-05T00:00:00Z"), endsAt: t("2026-11-05T00:00:00Z") })).toThrow();
  });
});
