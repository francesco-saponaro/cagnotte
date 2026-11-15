import { describe, expect, it } from "vitest";
import { formatDate, formatDay, formatRate, formatSigned, inDays, offerRateLabel } from "@/ui/format";
import { titleWithoutMerchant } from "@/screens/offers";

describe("formatting for the screens", () => {
  it("writes a percent offer as a whole or one-decimal percent and a fixed one in euros", () => {
    expect(formatRate({ rateKind: "percent", rateBps: 600, fixedCents: 0 })).toBe("6 %");
    expect(formatRate({ rateKind: "percent", rateBps: 250, fixedCents: 0 })).toBe("2,5 %");
    expect(formatRate({ rateKind: "fixed", rateBps: 0, fixedCents: 500 })).toBe("5,00 €");
  });

  it("labels an offer's rate with what it is back on", () => {
    expect(offerRateLabel({ rateKind: "percent", rateBps: 600, fixedCents: 0, minSpendCents: 0 })).toBe("6 % back");
    expect(offerRateLabel({ rateKind: "fixed", rateBps: 0, fixedCents: 500, minSpendCents: 3000 })).toBe("5,00 € back from 30,00 €");
  });

  it("formats dates the French way and days relative to now", () => {
    expect(formatDate("2027-01-14T10:00:00.000Z")).toBe("14 janv. 2027");
    expect(formatDay("2027-01-14T10:00:00.000Z")).toBe("14/01/2027");
    const now = new Date("2026-11-15T18:00:00.000Z");
    expect(inDays("2026-11-15T20:00:00.000Z", now)).toBe("today");
    expect(inDays("2026-11-16T09:00:00.000Z", now)).toBe("tomorrow");
    expect(inDays("2026-11-25T09:00:00.000Z", now)).toBe("in 10 days");
    expect(inDays("2026-11-10T09:00:00.000Z", now)).toBe("5 days ago");
  });

  it("drops the merchant's name from an offer title shown beside the merchant", () => {
    expect(titleWithoutMerchant("Maison Vernet: 6 % back on everything", "Maison Vernet")).toBe("6 % back on everything");
    expect(titleWithoutMerchant("Spring sale", "Maison Vernet")).toBe("Spring sale");
  });

  it("signs a ledger amount", () => {
    expect(formatSigned(1169)).toBe("+11,69 €");
    expect(formatSigned(-2000)).toBe("−20,00 €");
    expect(formatSigned(0)).toBe("0,00 €");
  });
});
