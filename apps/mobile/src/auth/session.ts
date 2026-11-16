import type { SignedInRow, UserRow } from "../api/types";

/*
 * The session the app holds: the opaque token the API gave and the user it belongs to. It lives in
 * memory for the screens and in storage so the app opens signed in; it is dropped when it expires,
 * when the member signs out, or when the API answers 401.
 */

export interface SessionStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SessionStatus = "loading" | "signed-out" | "signed-in";

export interface SessionState {
  status: SessionStatus;
  token: string | null;
  user: UserRow | null;
  /** When the API said the token dies, as it gave it; demo mode writes the session back with it. */
  expiresAt: string | null;
}

export interface SessionStore {
  get(): SessionState;
  subscribe(listener: () => void): () => void;
  /** Reads storage once at start-up. */
  load(): Promise<void>;
  signIn(signedIn: SignedInRow): Promise<void>;
  signOut(): Promise<void>;
}

export const SESSION_KEY = "cagnotte.session";

const SIGNED_OUT: SessionState = { status: "signed-out", token: null, user: null, expiresAt: null };

interface Stored {
  token: string;
  user: UserRow;
  expiresAt: string;
}

function readStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string" || !parsed.user || typeof parsed.user !== "object") return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

export function sessionStoreCreator(storage: SessionStorage): SessionStore {
  let state: SessionState = { status: "loading", token: null, user: null, expiresAt: null };
  const listeners = new Set<() => void>();

  const set = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const stored = readStored(await storage.get(SESSION_KEY));
      if (!stored) {
        await storage.remove(SESSION_KEY);
        set(SIGNED_OUT);
        return;
      }
      set({ status: "signed-in", token: stored.token, user: stored.user, expiresAt: stored.expiresAt });
    },
    async signIn({ user, token, expiresAt }) {
      await storage.set(SESSION_KEY, JSON.stringify({ token, user, expiresAt } satisfies Stored));
      set({ status: "signed-in", token, user, expiresAt });
    },
    async signOut() {
      await storage.remove(SESSION_KEY);
      set(SIGNED_OUT);
    },
  };
}

/** Storage for tests and for a browser that refuses localStorage. */
export function memoryStorage(): SessionStorage {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}
