import { describe, expect, it } from "vitest";
import { cryptoIdGeneratorCreator, systemClock } from "../src/index.js";

describe("cryptoIdGeneratorCreator", () => {
  const ids = cryptoIdGeneratorCreator();

  it("makes prefixed ids of 20 lower-case alphanumerics that never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = ids.id("act_");
      expect(id).toMatch(/^act_[a-z0-9]{20}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });

  it("makes tokens of the asked length from the same alphabet, without bias towards its start", () => {
    const token = ids.token(5000);
    expect(token).toMatch(/^[a-z0-9]{5000}$/);
    const counts = new Map<string, number>();
    for (const c of token) counts.set(c, (counts.get(c) ?? 0) + 1);
    // 36 symbols over 5000 draws: about 139 each; a modulo bias would push the first ones far above.
    for (const n of counts.values()) expect(n).toBeGreaterThan(80);
    expect(counts.size).toBe(36);
  });
});

describe("systemClock", () => {
  it("reads the wall clock", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
