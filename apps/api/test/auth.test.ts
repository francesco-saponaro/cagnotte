import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAILS, testApi, type TestApi } from "./harness.js";

let api: TestApi;
beforeAll(async () => {
  api = await testApi({ authRateLimit: { max: 30, timeWindow: "1 minute" } });
});
afterAll(() => api.close());

describe("POST /auth/sign-in", () => {
  it("returns the user and a bearer token for a demo account", async () => {
    const res = await api.call("POST", "/auth/sign-in", { body: { email: "Marie@example.com", password: "cagnotte-demo" } });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: EMAILS.member, role: "member", displayName: "Marie Lefebvre" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.token).toMatch(/^[a-z0-9]{48}$/);
    expect(typeof res.body.expiresAt).toBe("string");
  });

  it("answers 401 with the same message for a wrong password or an unknown email", async () => {
    const wrong = await api.call("POST", "/auth/sign-in", { body: { email: EMAILS.member, password: "nope" } });
    const unknown = await api.call("POST", "/auth/sign-in", { body: { email: "nobody@example.com", password: "cagnotte-demo" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("unauthorized");
  });

  it("answers 400 with the field problems for a malformed body", async () => {
    const res = await api.call("POST", "/auth/sign-in", { body: { email: "not-an-email" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid");
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "password"]);
  });
});

describe("POST /auth/sign-up", () => {
  it("creates a member, signs them in and records the referral", async () => {
    const res = await api.call("POST", "/auth/sign-up", { body: { email: "new@example.com", password: "Strong-pass-1", displayName: "New Member", referralCode: api.seed.users[0]!.referralCode } });
    expect(res.status).toBe(201);
    expect(res.body.user.referredBy).toBe(api.seed.users[0]!.id);
    const me = await api.call("GET", "/me", { token: res.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("new@example.com");
    const referrals = await api.call("GET", "/me/referrals", { token: api.tokens.member });
    expect(referrals.body.referees.some((r: { displayName: string }) => r.displayName === "New Member")).toBe(true);
  });

  it("refuses a taken email with 409 and a weak password with 400", async () => {
    expect((await api.call("POST", "/auth/sign-up", { body: { email: EMAILS.member, password: "Strong-pass-1", displayName: "Dup" } })).status).toBe(409);
    expect((await api.call("POST", "/auth/sign-up", { body: { email: "x@example.com", password: "weak", displayName: "Weak" } })).status).toBe(400);
  });

  it("refuses an unknown referral code with 422", async () => {
    const res = await api.call("POST", "/auth/sign-up", { body: { email: "y@example.com", password: "Strong-pass-1", displayName: "Y", referralCode: "nobody" } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("rule");
  });
});

describe("the session", () => {
  it("is required on every /me route and dies on sign-out", async () => {
    expect((await api.call("GET", "/me")).status).toBe(401);
    expect((await api.call("GET", "/me", { token: "garbage" })).status).toBe(401);
    const token = await api.signIn(EMAILS.member);
    expect((await api.call("GET", "/me", { token })).status).toBe(200);
    expect((await api.call("POST", "/auth/sign-out", { token })).status).toBe(204);
    expect((await api.call("GET", "/me", { token })).status).toBe(401);
  });

  it("is rate limited on /auth, per address, and nowhere else", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await api.call("POST", "/auth/sign-in", { body: { email: "nobody@example.com", password: "x" } })).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);
    const limited = await api.call("POST", "/auth/sign-up", { body: {} });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect((await api.call("GET", "/health")).status).toBe(200);
    expect((await api.call("GET", "/me", { token: api.tokens.member })).status).toBe(200);
  });
});
