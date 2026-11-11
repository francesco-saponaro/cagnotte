import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("reads the variables of .env.example with their defaults", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x" })).toEqual({
      databaseUrl: "postgres://x",
      port: 3001,
      host: "127.0.0.1",
      webOrigin: null,
      sessionHours: 72,
      seedOnStart: false,
    });
  });

  it("refuses to start without a database or with a nonsense port", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(() => readConfig({ DATABASE_URL: "postgres://x", PORT: "abc" })).toThrow(/PORT/);
  });
});
