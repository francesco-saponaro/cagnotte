import { hashPassword, inMemoryPortsCreator, useCasesCreator, type Activation, type Actor, type Cashback, type Deps, type IdGenerator, type LedgerEntry, type Merchant, type MemoryStore, type Offer, type User } from "../src/index.js";

/*
 * A small world for the use-case tests: three users (one per role), two merchants, three offers,
 * a fixed clock and ids that count up, so every expectation can be written out in full.
 */

export const NOW = new Date("2026-11-12T20:00:00Z");
export const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

export const MEMBER: Actor = { id: "usr_member", role: "member" };
export const OTHER: Actor = { id: "usr_other", role: "member" };
export const AGENT: Actor = { id: "usr_agent", role: "agent" };
export const MANAGER: Actor = { id: "usr_manager", role: "manager" };

export const PASSWORD = "Correct-horse-9";
export const PASSWORD_HASH = await hashPassword(PASSWORD, new Uint8Array(16).fill(1));

export function sequentialIds(): IdGenerator {
  const counters = new Map<string, number>();
  return {
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}${n}`;
    },
    token: (length) => "t".repeat(length),
  };
}

export const user = (id: string, role: User["role"], extra: Partial<User> = {}): User => ({
  id,
  email: `${id.replace("usr_", "")}@example.com`,
  passwordHash: PASSWORD_HASH,
  displayName: id.replace("usr_", ""),
  role,
  referralCode: id.replace("usr_", ""),
  referredBy: null,
  createdAt: daysAgo(100),
  ...extra,
});

export const merchant = (id: string, extra: Partial<Merchant> = {}): Merchant => ({
  id,
  slug: id.replace("_", "-"),
  name: `Shop ${id}`,
  category: "fashion",
  country: "FR",
  attributionDays: 30,
  network: "linkpool",
  advertiserRef: `LP-${id}`,
  ...extra,
});

export const offer = (id: string, merchantId: string, extra: Partial<Offer> = {}): Offer => ({
  id,
  merchantId,
  kind: "online",
  title: `Offer ${id}`,
  description: "",
  rateKind: "percent",
  rateBps: 500,
  fixedCents: 0,
  minSpendCents: 0,
  newCustomersOnly: false,
  capCents: null,
  validationDays: 30,
  status: "live",
  startsAt: daysAgo(90),
  endsAt: null,
  createdAt: daysAgo(90),
  updatedAt: daysAgo(90),
  ...extra,
});

export const activation = (id: string, userId: string, offerId: string, activatedAt: Date, extra: Partial<Activation> = {}): Activation => ({
  id,
  userId,
  offerId,
  subId: id.padEnd(16, "0"),
  rateBps: 500,
  boosted: false,
  activatedAt,
  trackingUrl: "https://track.example/go",
  ...extra,
});

export const cashback = (id: string, userId: string, offerId: string, extra: Partial<Cashback> = {}): Cashback => ({
  id,
  userId,
  offerId,
  activationId: null,
  networkTransactionId: null,
  orderCents: 10000,
  rateBps: 500,
  amountCents: 500,
  marginClamped: false,
  status: "pending",
  decidedBy: null,
  decisionReason: null,
  expectedValidationAt: daysAgo(-10),
  validatedAt: null,
  decidedAt: null,
  createdAt: daysAgo(20),
  ...extra,
});

export const entry = (id: string, userId: string, bucket: LedgerEntry["bucket"], amountCents: number, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  userId,
  kind: "cashback_validated",
  bucket,
  amountCents,
  refType: "cashback",
  refId: "cb_seed",
  note: null,
  createdBy: null,
  createdAt: daysAgo(15),
  ...extra,
});

export function world(extra: Partial<MemoryStore> = {}) {
  const base: Partial<MemoryStore> = {
    users: [user("usr_member", "member"), user("usr_other", "member"), user("usr_agent", "agent"), user("usr_manager", "manager")],
    merchants: [merchant("mer_a"), merchant("mer_b", { category: "tech", network: "affinet", advertiserRef: "AF-b" })],
    offers: [
      offer("ofr_live", "mer_a", { rateBps: 600, createdAt: daysAgo(80) }),
      offer("ofr_paused", "mer_a", { status: "paused", rateBps: 900, createdAt: daysAgo(70) }),
      offer("ofr_draft", "mer_b", { status: "draft", createdAt: daysAgo(60) }),
      offer("ofr_fixed", "mer_b", { rateKind: "fixed", rateBps: 0, fixedCents: 1000, createdAt: daysAgo(50) }),
    ],
  };
  const merged: Partial<MemoryStore> = { ...base };
  for (const [k, v] of Object.entries(extra)) merged[k as keyof MemoryStore] = [...((base[k as keyof MemoryStore] as unknown[]) ?? []), ...(v as unknown[])] as never;
  const { ports, unitOfWork, store } = inMemoryPortsCreator(merged);
  let now = NOW;
  const deps: Deps = { ports, unitOfWork, clock: { now: () => now }, ids: sequentialIds(), sessionHours: 72 };
  const useCases = useCasesCreator(deps);
  return { ...useCases, ports, store, deps, setNow: (d: Date) => (now = d) };
}

export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function errorOf<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: unknown } }): { code: string; message: string; details?: unknown } {
  if (result.ok) throw new Error("expected an error, got ok");
  return result.error;
}
