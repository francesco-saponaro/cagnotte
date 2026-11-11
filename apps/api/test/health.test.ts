import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectPglite } from "@cagnotte/postgres";
import { buildApp } from "../src/app.js";

describe("the server", () => {
  let app: ReturnType<typeof buildApp>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const conn = await connectPglite();
    close = conn.close;
    app = buildApp({ db: conn.db, webOrigin: null });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  it("answers the health check", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
