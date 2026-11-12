import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApi, type TestApi } from "./harness.js";

/*
 * Every route, its least role, and what a lower role gets: 401 without a session, 403 with one of
 * the wrong role, before any lookup, so a member cannot learn whether a claim id exists.
 */

type Role = "member" | "agent" | "manager";
type Row = [method: "GET" | "POST" | "PATCH", url: string, role: Role, body?: unknown];

let api: TestApi;
beforeAll(async () => {
  api = await testApi();
});
afterAll(() => api.close());

const ROUTES: Row[] = [
  ["GET", "/me", "member"],
  ["GET", "/offers", "member"],
  ["GET", "/offers/ofr_000001", "member"],
  ["POST", "/offers/ofr_000001/activate", "member"],
  ["GET", "/me/activations", "member"],
  ["GET", "/me/cashbacks", "member"],
  ["GET", "/me/cashbacks/cb_000001", "member"],
  ["GET", "/me/wallet", "member"],
  ["GET", "/me/payouts", "member"],
  ["POST", "/me/payouts", "member", { method: "donation", amountCents: 500, destination: "x" }],
  ["GET", "/me/claims", "member"],
  ["POST", "/me/claims", "member", {}],
  ["GET", "/me/claims/clm_000001", "member"],
  ["GET", "/me/referrals", "member"],
  ["GET", "/claims", "agent"],
  ["GET", "/claims/clm_000001", "agent"],
  ["POST", "/claims/clm_000001/assign", "agent", { assigneeId: "usr_000002" }],
  ["POST", "/claims/clm_000001/acknowledge", "agent"],
  ["POST", "/claims/clm_000001/raise", "agent", {}],
  ["POST", "/claims/clm_000001/decline", "agent", { reason: "order_returned" }],
  ["GET", "/users/usr_000001/wallet", "agent"],
  ["GET", "/users/usr_000001/cashbacks", "agent"],
  ["GET", "/merchants", "agent"],
  ["POST", "/merchants", "manager", {}],
  ["POST", "/offers", "manager", {}],
  ["PATCH", "/offers/ofr_000001", "manager", {}],
  ["POST", "/offers/ofr_000001/publish", "manager"],
  ["POST", "/offers/ofr_000001/pause", "manager"],
  ["POST", "/offers/ofr_000001/resume", "manager"],
  ["POST", "/offers/ofr_000001/end", "manager"],
  ["POST", "/offers/ofr_000001/boosts", "manager", {}],
  ["POST", "/cashbacks/cb_000001/validate", "manager", { reason: "x" }],
  ["POST", "/cashbacks/cb_000001/refuse", "manager", { reason: "x" }],
  ["POST", "/cashbacks/cb_000001/cancel", "manager", { reason: "x" }],
  ["GET", "/payouts", "manager"],
  ["POST", "/payouts/pay_000001/check", "manager"],
  ["POST", "/payouts/pay_000001/send", "manager"],
  ["POST", "/payouts/pay_000001/fail", "manager", { reason: "x" }],
  ["GET", "/reports/overview", "manager"],
  ["GET", "/reports/margin", "manager"],
  ["GET", "/audit", "manager"],
];

const BELOW: Record<Role, Role[]> = { member: [], agent: ["member"], manager: ["member", "agent"] };

describe("access to every route", () => {
  it("is refused with 401 without a session", async () => {
    for (const [method, url, , body] of ROUTES) {
      const res = await api.call(method, url, { body });
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });

  it("is refused with 403 for a role below the route's", async () => {
    for (const [method, url, role, body] of ROUTES) {
      for (const lower of BELOW[role]) {
        const res = await api.call(method, url, { token: api.tokens[lower], body });
        expect(res.status, `${method} ${url} as ${lower}`).toBe(403);
        expect(res.body.error.code).toBe("forbidden");
      }
    }
  });

  it("never answers a role check with a lookup result", async () => {
    const res = await api.call("POST", "/claims/clm_nope/acknowledge", { token: api.tokens.member });
    expect(res.status).toBe(403);
  });

  it("answers 404 for an unknown route and for an unknown id", async () => {
    expect((await api.call("GET", "/nothing", { token: api.tokens.member })).status).toBe(404);
    const res = await api.call("GET", "/me/cashbacks/cb_nope", { token: api.tokens.member });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
