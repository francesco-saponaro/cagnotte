import { describe, expect, it } from "vitest";
import { memoryStorage, sessionStoreCreator } from "@/auth/session";

/*
 * The session the app holds: the token the API gave and the user it belongs to, kept in storage so
 * the app opens signed in, and dropped when it expires or the member signs out.
 */

const marie = { id: "usr_marie", email: "marie@example.com", displayName: "Marie Dubois", role: "member" as const, referralCode: "marie7k", referredBy: null, createdAt: "2026-01-02T00:00:00.000Z" };
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe("the session store", () => {
  it("starts loading, then is signed out when storage holds nothing", async () => {
    const store = sessionStoreCreator(memoryStorage());
    expect(store.get().status).toBe("loading");
    await store.load();
    expect(store.get()).toEqual({ status: "signed-out", token: null, user: null });
  });

  it("signs in, tells its subscribers and writes the session to storage", async () => {
    const storage = memoryStorage();
    const store = sessionStoreCreator(storage);
    await store.load();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get().status));
    await store.signIn({ user: marie, token: "tok", expiresAt: inAnHour() });
    expect(store.get()).toMatchObject({ status: "signed-in", token: "tok", user: { displayName: "Marie Dubois" } });
    expect(seen).toEqual(["signed-in"]);
    expect(await storage.get("cagnotte.session")).toContain("tok");
  });

  it("opens signed in from a stored session that has not expired", async () => {
    const storage = memoryStorage();
    await sessionStoreCreator(storage).signIn({ user: marie, token: "tok", expiresAt: inAnHour() });
    const again = sessionStoreCreator(storage);
    await again.load();
    expect(again.get()).toMatchObject({ status: "signed-in", token: "tok", user: { id: "usr_marie" } });
  });

  it("drops a stored session that has expired", async () => {
    const storage = memoryStorage();
    await sessionStoreCreator(storage).signIn({ user: marie, token: "tok", expiresAt: new Date(Date.now() - 1000).toISOString() });
    const again = sessionStoreCreator(storage);
    await again.load();
    expect(again.get().status).toBe("signed-out");
    expect(await storage.get("cagnotte.session")).toBeNull();
  });

  it("drops a stored session it cannot read instead of crashing", async () => {
    const storage = memoryStorage();
    await storage.set("cagnotte.session", "{not json");
    const store = sessionStoreCreator(storage);
    await store.load();
    expect(store.get().status).toBe("signed-out");
  });

  it("signs out: the token is gone from memory and from storage", async () => {
    const storage = memoryStorage();
    const store = sessionStoreCreator(storage);
    await store.signIn({ user: marie, token: "tok", expiresAt: inAnHour() });
    await store.signOut();
    expect(store.get()).toEqual({ status: "signed-out", token: null, user: null });
    expect(await storage.get("cagnotte.session")).toBeNull();
  });

  it("returns the same state object until something changes, so React does not re-render for nothing", async () => {
    const store = sessionStoreCreator(memoryStorage());
    await store.load();
    expect(store.get()).toBe(store.get());
  });
});
