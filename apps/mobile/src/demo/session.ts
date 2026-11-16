import { sessionIdOf } from "@cagnotte/domain";
import { drizzlePortsCreator } from "@cagnotte/postgres/adapters";
import type { Db } from "@cagnotte/postgres/db";

/*
 * The demo's database starts empty of sessions on every page load, while the browser still holds
 * the token it was given before the reload. The server would answer 401 and the app would sign
 * out; in demo mode the token is written back as a session row instead, so a reload keeps the
 * member signed in. Hashed and dated like the real thing, so the use cases treat it the same.
 */

export interface KeptSession {
  token: string;
  userId: string;
  expiresAt: Date;
}

export async function restoreSession(db: Db, kept: KeptSession, now: Date = new Date()): Promise<void> {
  if (kept.expiresAt.getTime() <= now.getTime()) return;
  const { ports } = drizzlePortsCreator(db);
  await ports.sessions.insert({ id: sessionIdOf(kept.token), userId: kept.userId, createdAt: now, expiresAt: kept.expiresAt });
}
