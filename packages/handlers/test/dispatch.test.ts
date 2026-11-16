import { cryptoIdGeneratorCreator, inMemoryPortsCreator, systemClock, useCasesCreator, type UseCases } from "@cagnotte/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { dispatcherCreator, routesCreator, type Dispatch } from "../src/index.js";

/*
 * The route table and the dispatcher, on the in-memory ports: no server, no database. The same
 * dispatcher answers the browser demo, so what it does with a bad body, a missing token and a
 * wrong role is what the demo shows.
 */

let useCases: UseCases;
let dispatch: Dispatch;
let token: string;

beforeAll(async () => {
  const { ports, unitOfWork } = inMemoryPortsCreator();
  useCases = useCasesCreator({ ports, unitOfWork, clock: systemClock, ids: cryptoIdGeneratorCreator(), sessionHours: 72 });
  dispatch = dispatcherCreator(routesCreator(useCases), useCases);
  const signedUp = await dispatch({ method: "POST", path: "/auth/sign-up", body: { email: "lea@example.com", password: "Correct-horse-9", displayName: "Léa" }, token: null });
  expect(signedUp.status).toBe(201);
  token = (signedUp.body as { token: string }).token;
});

describe("the route table", () => {
  it("names the least role of every route, and no role for signing up and in", () => {
    const routes = routesCreator(useCases);
    const by = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path);
    expect(by("POST", "/auth/sign-up")?.role).toBeNull();
    expect(by("POST", "/auth/sign-in")?.role).toBeNull();
    expect(by("GET", "/me")?.role).toBe("member");
    expect(by("GET", "/claims")?.role).toBe("agent");
    expect(by("GET", "/audit")?.role).toBe("manager");
    expect(by("POST", "/offers/:id/boosts")?.role).toBe("manager");
    expect(routes).toHaveLength(53);
  });

  it("lists each method and path once", () => {
    const keys = routesCreator(useCases).map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the dispatcher", () => {
  it("answers 404 for a path no route has", async () => {
    const res = await dispatch({ method: "GET", path: "/nothing/here", token });
    expect(res).toEqual({ status: 404, body: { error: { code: "not_found", message: "no such route" } } });
  });

  it("refuses a signed-in route without a token with 401", async () => {
    const res = await dispatch({ method: "GET", path: "/me", token: null });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("refuses a role below the route's with 403 before looking anything up", async () => {
    const res = await dispatch({ method: "GET", path: "/claims/clm_nothing", token });
    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toBe("agent role required");
  });

  it("answers 400 with one line per field when the body cannot be read", async () => {
    const res = await dispatch({ method: "POST", path: "/me/payouts", body: { method: "cheque", amountCents: "ten", destination: "" }, token });
    expect(res.status).toBe(400);
    const error = (res.body as { error: { code: string; details: { path: string; message: string }[] } }).error;
    expect(error.code).toBe("invalid");
    expect(error.details.map((d) => d.path).sort()).toEqual(["amountCents", "destination", "method"]);
  });

  it("answers 422 with the use case's sentence when a rule refuses", async () => {
    const res = await dispatch({ method: "POST", path: "/me/payouts", body: { method: "donation", amountCents: 100, destination: "Restos du Cœur" }, token });
    expect(res.status).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toBe("the minimum for this method is 5,00 €");
  });

  it("reads the query as strings and parses it with the route's schema", async () => {
    const res = await dispatch({ method: "GET", path: "/offers", query: { page: "1", pageSize: "5", sort: "name" }, token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 5 });
    const bad = await dispatch({ method: "GET", path: "/offers", query: { pageSize: "500" }, token });
    expect(bad.status).toBe(400);
  });

  it("fills the path parameters and returns the use case's value with the route's status", async () => {
    const me = await dispatch({ method: "GET", path: "/me", token });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "lea@example.com", role: "member" });
    const missing = await dispatch({ method: "GET", path: "/me/claims/clm_nothing", token });
    expect(missing.status).toBe(404);
  });

  it("answers 204 with no body where the route says so", async () => {
    const res = await dispatch({ method: "POST", path: "/auth/sign-out", token });
    expect(res).toEqual({ status: 204, body: undefined });
    const after = await dispatch({ method: "GET", path: "/me", token });
    expect(after.status).toBe(401);
  });
});
