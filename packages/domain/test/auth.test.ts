import { describe, expect, it } from "vitest";
import { MEMBER, NOW, PASSWORD, daysAgo, errorOf, unwrap, user, world } from "./harness.js";

describe("signUp", () => {
  const input = { email: "New.Member@Example.com", password: "Strong-pass-1", displayName: "New Member" };

  it("creates a member with a lower-cased email, a referral code and a session", async () => {
    const w = world();
    const out = unwrap(await w.signUp(input));
    expect(out.user.email).toBe("new.member@example.com");
    expect(out.user.role).toBe("member");
    expect(out.user.referralCode).toMatch(/^new[a-z0-9]{2}$/);
    expect(out.user).not.toHaveProperty("passwordHash");
    expect(out.token).toHaveLength(48);
    expect(out.expiresAt).toEqual(new Date(NOW.getTime() + 72 * 60 * 60 * 1000));
    expect(w.store.users.at(-1)?.passwordHash).toMatch(/^scrypt\$/);
    expect(w.store.sessions).toHaveLength(1);
  });

  it("refuses a weak password, naming what is missing", async () => {
    const e = errorOf(await world().signUp({ ...input, password: "short" }));
    expect(e.code).toBe("invalid");
    expect(e.details).toEqual(["at least 10 characters", "an upper-case letter", "a digit"]);
  });

  it("refuses a malformed email and a blank name", async () => {
    expect(errorOf(await world().signUp({ ...input, email: "not-an-email" })).code).toBe("invalid");
    expect(errorOf(await world().signUp({ ...input, displayName: "  " })).code).toBe("invalid");
  });

  it("refuses an email already taken, whatever its case", async () => {
    const e = errorOf(await world().signUp({ ...input, email: "MEMBER@example.com" }));
    expect(e.code).toBe("conflict");
  });

  it("records a pending referral with a 90-day expiry when a valid code is given", async () => {
    const w = world();
    const out = unwrap(await w.signUp({ ...input, referralCode: " OTHER " }));
    expect(out.user.referredBy).toBe("usr_other");
    const r = w.store.referrals[0]!;
    expect(r.referrerId).toBe("usr_other");
    expect(r.refereeId).toBe(out.user.id);
    expect(r.status).toBe("pending");
    expect(r.expiresAt).toEqual(new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
  });

  it("refuses an unknown referral code", async () => {
    expect(errorOf(await world().signUp({ ...input, referralCode: "nobody" })).code).toBe("rule");
  });

  it("refuses a code that has already been used twenty times", async () => {
    const referrals = Array.from({ length: 20 }, (_, i) => ({ id: `ref_${i}`, referrerId: "usr_other", refereeId: `usr_r${i}`, code: "other", status: "pending" as const, createdAt: daysAgo(1), expiresAt: null, validatedAt: null, bonusUntil: null }));
    const users = Array.from({ length: 20 }, (_, i) => user(`usr_r${i}`, "member"));
    const e = errorOf(await world({ referrals, users }).signUp({ ...input, referralCode: "other" }));
    expect(e.code).toBe("rule");
    expect(e.message).toMatch(/twenty/);
  });
});

describe("signIn and the session", () => {
  it("returns a token for the right password and nothing else for the wrong one", async () => {
    const w = world();
    const out = unwrap(await w.signIn({ email: "Member@example.com", password: PASSWORD }));
    expect(out.user.id).toBe("usr_member");
    expect(w.store.sessions).toHaveLength(1);
    expect(w.store.sessions[0]?.id).not.toBe(out.token);
    expect(errorOf(await w.signIn({ email: "member@example.com", password: "wrong" })).code).toBe("unauthorized");
    expect(errorOf(await w.signIn({ email: "nobody@example.com", password: PASSWORD })).code).toBe("unauthorized");
  });

  it("authenticates a token until it expires or is signed out", async () => {
    const w = world();
    const { token } = unwrap(await w.signIn({ email: "member@example.com", password: PASSWORD }));
    expect(unwrap(await w.authenticate(token)).actor).toEqual(MEMBER);
    expect(errorOf(await w.authenticate("garbage")).code).toBe("unauthorized");
    w.setNow(new Date(NOW.getTime() + 73 * 60 * 60 * 1000));
    expect(errorOf(await w.authenticate(token)).code).toBe("unauthorized");
    w.setNow(NOW);
    unwrap(await w.signOut(token));
    expect(errorOf(await w.authenticate(token)).code).toBe("unauthorized");
  });

  it("describes the signed-in user without the hash", async () => {
    const w = world();
    const me = unwrap(await w.me(MEMBER));
    expect(me.email).toBe("member@example.com");
    expect(me).not.toHaveProperty("passwordHash");
  });
});
