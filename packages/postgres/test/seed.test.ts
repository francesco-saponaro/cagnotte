import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, sql } from "drizzle-orm";
import { applyRate, boostsOverlap, verifyPassword } from "@cagnotte/domain";
import { connectPglite, schema, type Db } from "../src/index.js";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, generateSeed, seedDatabase, type SeedData } from "../src/seed.js";

const NOW = new Date("2026-11-11T18:00:00Z");

let data: SeedData;

beforeAll(async () => {
  data = await generateSeed({ seed: 1, now: NOW });
});

const sumBy = <T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> => {
  const out = new Map<string, number>();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + value(r));
  return out;
};

describe("generateSeed", () => {
  it("is the same data for the same seed and different data for another", async () => {
    const again = await generateSeed({ seed: 1, now: NOW });
    expect(again).toEqual(data);
    const other = await generateSeed({ seed: 2, now: NOW });
    expect(other.activations.map((a) => a.subId)).not.toEqual(data.activations.map((a) => a.subId));
  });

  it("produces between 10,000 and 20,000 rows, with every table filled", () => {
    const tables = Object.entries(data) as [keyof SeedData, unknown[]][];
    const total = tables.reduce((n, [, rows]) => n + rows.length, 0);
    expect(total).toBeGreaterThanOrEqual(10_000);
    expect(total).toBeLessThanOrEqual(20_000);
    for (const [name, rows] of tables) expect(rows.length, name).toBeGreaterThan(0);
  });

  it("seeds the three demo accounts with the demo password hashed", async () => {
    for (const account of DEMO_ACCOUNTS) {
      const user = data.users.find((u) => u.email === account.email);
      expect(user, account.email).toBeDefined();
      expect(user?.role).toBe(account.role);
      expect(await verifyPassword(DEMO_PASSWORD, user?.passwordHash ?? "")).toBe(true);
    }
  });

  it("gives every user a unique lower-case referral code and a unique email", () => {
    const codes = data.users.map((u) => u.referralCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c === c.toLowerCase())).toBe(true);
    expect(new Set(data.users.map((u) => u.email)).size).toBe(data.users.length);
  });

  it("snapshots the rate in force on every activation, boost included", () => {
    const offers = new Map(data.offers.map((o) => [o.id, o]));
    const boosted = data.activations.filter((a) => a.boosted);
    expect(boosted.length).toBeGreaterThan(20);
    for (const a of data.activations) {
      const offer = offers.get(a.offerId)!;
      const boost = data.offerBoosts.find((b) => b.offerId === a.offerId && b.startsAt <= a.activatedAt && a.activatedAt < b.endsAt);
      const expected = boost && boost.rateBps > offer.rateBps ? boost.rateBps : offer.rateBps;
      expect(a.rateBps).toBe(expected);
      expect(a.boosted).toBe(Boolean(boost && boost.rateBps > offer.rateBps));
    }
  });

  it("never overlaps two boosts of the same offer", () => {
    const byOffer = new Map<string, typeof data.offerBoosts>();
    for (const b of data.offerBoosts) byOffer.set(b.offerId, [...(byOffer.get(b.offerId) ?? []), b]);
    for (const boosts of byOffer.values()) {
      for (let i = 0; i < boosts.length; i++) {
        expect(boostsOverlap(boosts.filter((_, j) => j !== i), boosts[i]!)).toBe(false);
      }
    }
  });

  it("matches a transaction only to an activation of the same member's offer at that merchant, before the order", () => {
    const activations = new Map(data.activations.map((a) => [a.id, a]));
    const offers = new Map(data.offers.map((o) => [o.id, o]));
    const matched = data.networkTransactions.filter((t) => t.matchStatus === "matched");
    const unmatched = data.networkTransactions.filter((t) => t.matchStatus === "unmatched");
    expect(matched.length).toBeGreaterThan(1000);
    expect(unmatched.length).toBeGreaterThan(50);
    for (const t of matched) {
      const a = activations.get(t.activationId!)!;
      expect(offers.get(a.offerId)!.merchantId).toBe(t.merchantId);
      expect(t.subId).toBe(a.subId);
      expect(a.activatedAt.getTime()).toBeLessThan(t.orderedAt.getTime());
      expect(t.orderedAt.getTime()).toBeLessThanOrEqual(t.reportedAt.getTime());
    }
    for (const t of unmatched) expect(t.activationId).toBeNull();
  });

  it("computes every cashback from its activation's rate, within the cap and the commission", () => {
    const activations = new Map(data.activations.map((a) => [a.id, a]));
    const offers = new Map(data.offers.map((o) => [o.id, o]));
    const transactions = new Map(data.networkTransactions.map((t) => [t.id, t]));
    let clamped = 0;
    for (const cb of data.cashbacks) {
      const offer = offers.get(cb.offerId)!;
      if (cb.activationId) {
        const a = activations.get(cb.activationId)!;
        expect(a.userId).toBe(cb.userId);
        expect(a.offerId).toBe(cb.offerId);
        expect(cb.rateBps).toBe(a.rateBps);
      }
      let expected = offer.rateKind === "fixed" ? offer.fixedCents : applyRate(cb.orderCents, cb.rateBps);
      if (offer.capCents !== null) expected = Math.min(expected, offer.capCents);
      if (cb.networkTransactionId) {
        const t = transactions.get(cb.networkTransactionId)!;
        expect(t.activationId).toBe(cb.activationId);
        if (t.commissionCents < expected) {
          expected = t.commissionCents;
          expect(cb.marginClamped).toBe(true);
          clamped++;
        }
      }
      expect(cb.amountCents).toBe(expected);
      expect(cb.amountCents).toBeGreaterThan(0);
      if (cb.status === "validated" || cb.status === "cancelled") expect(cb.validatedAt).not.toBeNull();
      if (cb.status === "pending") expect(cb.validatedAt).toBeNull();
    }
    expect(clamped).toBeGreaterThan(5);
  });

  it("books every cashback's ledger entries so they net to its status", () => {
    const byRef = new Map<string, typeof data.ledgerEntries>();
    for (const e of data.ledgerEntries) byRef.set(`${e.refType}:${e.refId}`, [...(byRef.get(`${e.refType}:${e.refId}`) ?? []), e]);
    for (const cb of data.cashbacks) {
      const entries = byRef.get(`cashback:${cb.id}`) ?? [];
      const pending = entries.filter((e) => e.bucket === "pending").reduce((n, e) => n + e.amountCents, 0);
      const available = entries.filter((e) => e.bucket === "available").reduce((n, e) => n + e.amountCents, 0);
      switch (cb.status) {
        case "pending":
          expect([pending, available]).toEqual([cb.amountCents, 0]);
          break;
        case "validated":
          expect([pending, available]).toEqual([0, cb.amountCents]);
          break;
        case "refused":
        case "cancelled":
          expect([pending, available]).toEqual([0, 0]);
          break;
      }
      for (const e of entries) expect(e.userId).toBe(cb.userId);
    }
  });

  it("books every payout against the reserved bucket and never lets a bucket go negative", () => {
    const byRef = new Map<string, typeof data.ledgerEntries>();
    for (const e of data.ledgerEntries) byRef.set(`${e.refType}:${e.refId}`, [...(byRef.get(`${e.refType}:${e.refId}`) ?? []), e]);
    for (const p of data.payouts) {
      const entries = byRef.get(`payout:${p.id}`) ?? [];
      const by = (bucket: string) => entries.filter((e) => e.bucket === bucket).reduce((n, e) => n + e.amountCents, 0);
      const expected = { requested: [-p.amountCents, p.amountCents, 0], checking: [-p.amountCents, p.amountCents, 0], sent: [-p.amountCents, 0, p.amountCents], failed: [0, 0, 0] }[p.status];
      expect([by("available"), by("reserved"), by("paid")], p.id).toEqual(expected);
      if (p.method === "transfer") expect(p.amountCents % 500).toBe(0);
      expect(p.amountCents).toBeGreaterThanOrEqual({ transfer: 2000, gift_card: 1500, donation: 500 }[p.method]);
    }
    const balances = sumBy(data.ledgerEntries, (e) => `${e.userId}:${e.bucket}`, (e) => e.amountCents);
    for (const [key, value] of balances) expect(value, key).toBeGreaterThanOrEqual(0);
  });

  it("reconciles: every euro in the ledger comes from a validated cashback, a manual credit or a bonus, less what was refused or paid", () => {
    const validated = data.cashbacks.filter((c) => c.status === "validated").reduce((n, c) => n + c.amountCents, 0);
    const pending = data.cashbacks.filter((c) => c.status === "pending").reduce((n, c) => n + c.amountCents, 0);
    const bonuses = data.ledgerEntries.filter((e) => e.kind === "referral_bonus").reduce((n, e) => n + e.amountCents, 0);
    const buckets = sumBy(data.ledgerEntries, (e) => e.bucket, (e) => e.amountCents);
    expect(buckets.get("pending")).toBe(pending);
    expect((buckets.get("available") ?? 0) + (buckets.get("reserved") ?? 0) + (buckets.get("paid") ?? 0)).toBe(validated + bonuses);
  });

  it("links a credited claim to a validated cashback decided by the claim, and leaves the others without one", () => {
    const cashbacks = new Map(data.cashbacks.map((c) => [c.id, c]));
    expect(data.claims.filter((c) => c.status === "credited").length).toBeGreaterThan(10);
    for (const claim of data.claims) {
      if (claim.status === "credited") {
        const cb = cashbacks.get(claim.cashbackId!)!;
        expect(cb.decidedBy).toBe("claim");
        expect(cb.status).toBe("validated");
        expect(cb.userId).toBe(claim.userId);
      } else {
        expect(claim.cashbackId).toBeNull();
      }
      if (claim.status === "declined") expect(claim.declineReason).not.toBeNull();
      if (claim.status !== "filed") expect(claim.assigneeId).not.toBeNull();
    }
  });

  it("pays the referral bonuses only once the referee has collected five euros", () => {
    const validatedByUser = sumBy(
      data.cashbacks.filter((c) => c.status === "validated" && c.decidedBy !== "claim"),
      (c) => c.userId,
      (c) => c.amountCents,
    );
    expect(data.referrals.filter((r) => r.status === "validated").length).toBeGreaterThan(5);
    for (const r of data.referrals) {
      const collected = validatedByUser.get(r.refereeId) ?? 0;
      if (r.status === "validated") {
        expect(collected).toBeGreaterThanOrEqual(500);
        expect(r.validatedAt).not.toBeNull();
        expect(r.bonusUntil).not.toBeNull();
      } else {
        expect(collected).toBeLessThan(500);
      }
    }
  });
});

describe("seedDatabase", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await connectPglite());
    await seedDatabase(db, data);
  });
  afterAll(() => close());

  it("inserts every row within the constraints", async () => {
    const [users] = await db.select({ n: count() }).from(schema.users);
    const [cashbacks] = await db.select({ n: count() }).from(schema.cashbacks);
    const [ledger] = await db.select({ n: count() }).from(schema.ledgerEntries);
    const [audit] = await db.select({ n: count() }).from(schema.auditLog);
    expect(users?.n).toBe(data.users.length);
    expect(cashbacks?.n).toBe(data.cashbacks.length);
    expect(ledger?.n).toBe(data.ledgerEntries.length);
    expect(audit?.n).toBe(data.auditLog.length);
  });

  it("can be loaded a second time without duplicating anything", async () => {
    await seedDatabase(db, data);
    const [users] = await db.select({ n: count() }).from(schema.users);
    expect(users?.n).toBe(data.users.length);
  });

  it("agrees with the database on a member's balances", async () => {
    const marie = data.users.find((u) => u.email === "marie@example.com")!;
    const rows = (await db.execute(
      sql`select bucket, sum(amount_cents)::int as total from ledger_entries where user_id = ${marie.id} group by bucket`,
    )) as { rows: { bucket: string; total: number }[] };
    const expected = sumBy(data.ledgerEntries.filter((e) => e.userId === marie.id), (e) => e.bucket, (e) => e.amountCents);
    for (const row of rows.rows) expect(row.total).toBe(expected.get(row.bucket));
    expect(expected.get("available") ?? 0).toBeGreaterThan(0);
  });
});
