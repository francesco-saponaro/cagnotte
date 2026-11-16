// @vitest-environment node
import { DEMO_PASSWORD, connectPglite, generateSeed, seedDatabase, type Connection } from "@cagnotte/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restoreSession } from "@/demo/session";
import { demoTransportCreator } from "@/demo/transport";
import type { Transport } from "@/api/transport";

/*
 * Demo mode is the API without the server: the route table dispatched on the use cases over
 * PGlite. Here PGlite runs in the test process with the seed, as it will run in the browser; the
 * transport must answer exactly what the HTTP transport answers for the same requests.
 */

let conn: Connection;
let opened = 0;
let transport: Transport;

beforeAll(async () => {
  conn = await connectPglite();
  await seedDatabase(conn.db, await generateSeed());
  transport = demoTransportCreator(async () => {
    opened += 1;
    return conn.db;
  });
});
afterAll(() => conn.close());

const signIn = async (email: string) => {
  const res = await transport.request({ method: "POST", path: "/auth/sign-in", body: { email, password: DEMO_PASSWORD }, token: null });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
};

describe("the demo transport", () => {
  it("refuses a signed-in route without a token, with the API's error shape", async () => {
    const res = await transport.request({ method: "GET", path: "/me/wallet", token: null });
    expect(res).toEqual({ status: 401, body: { error: { code: "unauthorized", message: "sign in first" } } });
  });

  it("signs Marie in against the seed and reads her wallet from the ledger", async () => {
    const token = await signIn("marie@example.com");
    const res = await transport.request({ method: "GET", path: "/me/wallet", query: { pageSize: 5 }, token });
    expect(res.status).toBe(200);
    const wallet = res.body as { balances: { available: number; pending: number }; ledger: { items: unknown[]; pageSize: number } };
    expect(wallet.balances.available).toBe(16910);
    expect(wallet.ledger.pageSize).toBe(5);
    expect(wallet.ledger.items).toHaveLength(5);
  });

  it("hands the screens what the wire would carry: dates as ISO strings, not Date objects", async () => {
    const token = await signIn("marie@example.com");
    const res = await transport.request({ method: "GET", path: "/me", token });
    const me = res.body as { createdAt: unknown };
    expect(typeof me.createdAt).toBe("string");
    expect(me.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sends the query as text, as a URL would carry it, so a flag given as a number is read like '1'", async () => {
    const token = await signIn("nadia@example.com");
    const res = await transport.request({ method: "GET", path: "/offers", query: { all: 1, page: 1, pageSize: 5, sort: "newest", q: undefined }, token });
    expect(res.status).toBe(200);
    const page = res.body as { items: { status: string }[]; total: number };
    expect(page.total).toBeGreaterThan(68);
    expect(page.items.some((o) => o.status !== "live")).toBe(true);
  });

  it("writes through the same use cases, so a payout request moves money to reserved", async () => {
    const token = await signIn("marie@example.com");
    const before = (await transport.request({ method: "GET", path: "/me/wallet", token })).body as { balances: { available: number; reserved: number } };
    const requested = await transport.request({ method: "POST", path: "/me/payouts", body: { method: "transfer", amountCents: 2000, destination: "FR76 •••• 0189" }, token });
    expect(requested.status).toBe(201);
    const after = (await transport.request({ method: "GET", path: "/me/wallet", token })).body as { balances: { available: number; reserved: number } };
    expect(after.balances.available).toBe(before.balances.available - 2000);
    expect(after.balances.reserved).toBe(before.balances.reserved + 2000);
  });

  it("answers a rule refusal as a 422 with the use case's words", async () => {
    const token = await signIn("marie@example.com");
    const res = await transport.request({ method: "POST", path: "/me/payouts", body: { method: "transfer", amountCents: 1500, destination: "x" }, token });
    expect(res.status).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toBe("the minimum for this method is 20,00 €");
  });

  it("answers 204 with no body on sign-out", async () => {
    const token = await signIn("sam@example.com");
    expect(await transport.request({ method: "POST", path: "/auth/sign-out", token })).toEqual({ status: 204, body: undefined });
  });

  it("opens the database once for every request", () => {
    expect(opened).toBe(1);
  });

  it("re-creates the session the browser kept, since the database restarts with the page", async () => {
    const kept = { token: "k".repeat(48), userId: "usr_000001", expiresAt: new Date(Date.now() + 3_600_000) };
    const fresh = demoTransportCreator(async () => {
      await restoreSession(conn.db, kept);
      return conn.db;
    });
    const res = await fresh.request({ method: "GET", path: "/me", token: kept.token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "usr_000001" });
  });

  it("drops a kept session that has already expired", async () => {
    const stale = { token: "s".repeat(48), userId: "usr_000001", expiresAt: new Date(Date.now() - 1000) };
    await restoreSession(conn.db, stale);
    const res = await transport.request({ method: "GET", path: "/me", token: stale.token });
    expect(res.status).toBe(401);
  });

  it("answers 500 with the API's error shape when the database cannot be opened", async () => {
    const broken = demoTransportCreator(async () => {
      throw new Error("the browser refused the WebAssembly module");
    });
    const res = await broken.request({ method: "POST", path: "/auth/sign-in", body: { email: "marie@example.com", password: DEMO_PASSWORD }, token: null });
    expect(res.status).toBe(500);
    expect((res.body as { error: { code: string; message: string } }).error).toEqual({ code: "internal", message: "the demo database could not be opened: the browser refused the WebAssembly module" });
  });
});
