import { apiClientCreator } from "./api/client";
import { httpTransportCreator } from "./api/http";
import type { Transport } from "./api/transport";
import { sessionStoreCreator, type SessionStore } from "./auth/session";
import { platformStorage } from "./auth/storage";
import { demoTransportCreator } from "./demo/transport";
import { makeQueryClient, type AppDeps } from "./app-context";
import type { Nav } from "./ui/nav";

/*
 * The app's wiring, built once when it starts. `EXPO_PUBLIC_API_URL` names the API; when it is
 * empty the app runs in demo mode: the same route table and use cases over PostgreSQL in the
 * page (PGlite), with the migration and the seed loaded on the first request.
 */

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export const demoMode = API_URL.length === 0;

function transportFor(apiUrl: string, session: SessionStore): Transport {
  if (apiUrl.length > 0) return httpTransportCreator(apiUrl);
  // The engine, the schema and the seed load with the first request, not with the page: the
  // bundle that paints the sign-in screen stays small, and the static render never evaluates them.
  // A session the browser kept from before a reload is written back, since the database is new.
  return demoTransportCreator(async () => {
    const [{ fetchDemoAssets, openDemoDatabase }, { restoreSession }] = await Promise.all([import("./demo/database"), import("./demo/session")]);
    const db = await openDemoDatabase(await fetchDemoAssets());
    const kept = session.get();
    if (kept.status === "signed-in" && kept.token && kept.user && kept.expiresAt) await restoreSession(db, { token: kept.token, userId: kept.user.id, expiresAt: new Date(kept.expiresAt) });
    return db;
  });
}

export function buildDeps(nav: Nav): AppDeps {
  const session = sessionStoreCreator(platformStorage());
  const transport = transportFor(API_URL, session);
  const api = apiClientCreator(transport, () => session.get().token);
  // A sign-in attempt answers 401 too; that one is the form's to show, not a reason to sign out.
  const queryClient = makeQueryClient(() => {
    if (session.get().status === "signed-in") void session.signOut();
  });
  return { api, session, nav, queryClient };
}
