import { describe, expect, it } from "vitest";
import { ApiError, apiClientCreator } from "@/api/client";
import { httpTransportCreator } from "@/api/http";

/*
 * The client turns a path, a query and a body into one request with the session's bearer token,
 * and turns the API's one error shape into one error class the screens can show.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the API client over HTTP", () => {
  it("builds the URL from the base, the path and the defined query values", async () => {
    const { calls, fetchFn } = fakeFetch(() => json(200, { items: [] }));
    const api = apiClientCreator(httpTransportCreator("http://api.test/", fetchFn), () => "tok");
    await api.get("/offers", { q: "shoes", page: 2, kind: undefined, all: true });
    expect(calls[0]?.url).toBe("http://api.test/offers?q=shoes&page=2&all=true");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("sends the session token as a bearer and the body as JSON", async () => {
    const { calls, fetchFn } = fakeFetch(() => json(201, { id: "pay_1" }));
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => "tok");
    const payout = await api.post<{ id: string }>("/me/payouts", { method: "transfer", amountCents: 2000 });
    expect(payout.id).toBe("pay_1");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ method: "transfer", amountCents: 2000 }));
  });

  it("sends no authorization header without a session", async () => {
    const { calls, fetchFn } = fakeFetch(() => json(200, {}));
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => null);
    await api.post("/auth/sign-in", { email: "a@b.c", password: "x" });
    expect(new Headers(calls[0]?.init.headers).has("authorization")).toBe(false);
  });

  it("turns the API's error shape into an ApiError with the status, code and message", async () => {
    const { fetchFn } = fakeFetch(() => json(422, { error: { code: "rule", message: "only 1,50 € is available" } }));
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => "tok");
    const error = await api.post("/me/payouts", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "rule", message: "only 1,50 € is available" });
  });

  it("keeps the field details of a 400 so a form can show them", async () => {
    const details = [{ path: ["amountCents"], message: "whole cents" }];
    const { fetchFn } = fakeFetch(() => json(400, { error: { code: "invalid", message: "invalid body", details } }));
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => "tok");
    const error = (await api.post("/me/payouts", {}).catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual(details);
    expect(error.fieldMessage("amountCents")).toBe("whole cents");
    expect(error.fieldMessage("method")).toBeNull();
  });

  it("returns nothing for a 204", async () => {
    const { fetchFn } = fakeFetch(() => new Response(null, { status: 204 }));
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => "tok");
    await expect(api.post("/auth/sign-out")).resolves.toBeUndefined();
  });

  it("reports a network failure as an ApiError with code network", async () => {
    const fetchFn = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const api = apiClientCreator(httpTransportCreator("http://api.test", fetchFn), () => "tok");
    const error = (await api.get("/me").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network");
    expect(error.status).toBe(0);
  });
});
