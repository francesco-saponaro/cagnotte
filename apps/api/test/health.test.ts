import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectPglite } from "@cagnotte/postgres";
import { buildApp } from "../src/http/app.js";

describe("the server", () => {
  let app: ReturnType<typeof buildApp>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const conn = await connectPglite();
    close = conn.close;
    app = buildApp({ db: conn.db, webOrigin: null, sessionHours: 72 });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  it("sends the headers that keep a browser from misreading or framing an answer", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("answers the health check", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
