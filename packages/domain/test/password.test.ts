import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblems, verifyPassword } from "../src/password.js";

describe("hashPassword and verifyPassword", () => {
  it("verifies the password it hashed and nothing else", async () => {
    const hash = await hashPassword("Correct-horse-9");
    expect(await verifyPassword("Correct-horse-9", hash)).toBe(true);
    expect(await verifyPassword("Correct-horse-8", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently twice", async () => {
    const a = await hashPassword("Correct-horse-9");
    const b = await hashPassword("Correct-horse-9");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
  });

  it("is false, not an exception, on a malformed hash", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$zz$zz")).toBe(false);
  });

  it("hashes with a fixed salt deterministically when the seed asks for it", async () => {
    const salt = new Uint8Array(16).fill(7);
    expect(await hashPassword("cagnotte-demo", salt)).toBe(await hashPassword("cagnotte-demo", salt));
  });
});

describe("passwordProblems", () => {
  it("accepts ten characters with a lower, an upper and a digit", () => {
    expect(passwordProblems("Cagnotte-2026")).toEqual([]);
  });

  it("names every rule the password breaks", () => {
    expect(passwordProblems("short1A")).toEqual(["at least 10 characters"]);
    expect(passwordProblems("alllowercase1")).toEqual(["an upper-case letter"]);
    expect(passwordProblems("ALLUPPERCASE1")).toEqual(["a lower-case letter"]);
    expect(passwordProblems("NoDigitsHere")).toEqual(["a digit"]);
    expect(passwordProblems("")).toEqual(["at least 10 characters", "a lower-case letter", "an upper-case letter", "a digit"]);
  });
});
