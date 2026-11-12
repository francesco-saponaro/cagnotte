import type { FastifyInstance, InjectOptions } from "fastify";
import { DEMO_PASSWORD, connectPglite, generateSeed, seedDatabase, type SeedData } from "@cagnotte/postgres";
import { buildApp, type AppOptions } from "../src/http/app.js";

/*
 * One PGlite with the whole seed per test file, and the demo accounts signed in. Requests go
 * through Fastify's inject, so every test exercises the real routes, parsing and error mapping.
 */

export interface TestApi {
  app: FastifyInstance;
  seed: SeedData;
  tokens: { member: string; agent: string; manager: string };
  // The body is whatever the route answered; tests assert on its shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: InjectOptions["method"], url: string, options?: { token?: string | null; body?: unknown }) => Promise<{ status: number; body: any }>;
  signIn: (email: string, password?: string) => Promise<string>;
  close: () => Promise<void>;
}

export const EMAILS = { member: "marie@example.com", agent: "sam@example.com", manager: "nadia@example.com" } as const;

export async function testApi(options: Partial<AppOptions> = {}): Promise<TestApi> {
  const conn = await connectPglite();
  const seed = await generateSeed();
  await seedDatabase(conn.db, seed);
  const app = buildApp({ db: conn.db, webOrigin: null, sessionHours: 72, ...options });
  await app.ready();

  const call: TestApi["call"] = async (method, url, { token, body } = {}) => {
    const options: InjectOptions = { method: method ?? "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} };
    if (body !== undefined) options.payload = body as string;
    const res = await app.inject(options);
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  const signIn = async (email: string, password = DEMO_PASSWORD): Promise<string> => {
    const res = await call("POST", "/auth/sign-in", { body: { email, password } });
    if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  };
  const tokens = { member: await signIn(EMAILS.member), agent: await signIn(EMAILS.agent), manager: await signIn(EMAILS.manager) };
  return {
    app,
    seed,
    tokens,
    call,
    signIn,
    close: async () => {
      await app.close();
      await conn.close();
    },
  };
}
