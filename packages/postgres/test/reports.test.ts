import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import type * as D from "@cagnotte/domain";
import type { InferSelectModel } from "drizzle-orm";
import { connectPglite, drizzlePortsCreator, generateSeed, seedDatabase, type Db, type SeedData, type schema } from "../src/index.js";

/** The entities the use cases see are the rows, field for field, in both directions. */
describe("rows and entities", () => {
  it("are the same shapes", () => {
    expectTypeOf<InferSelectModel<typeof schema.users>>().toEqualTypeOf<D.User>();
    expectTypeOf<InferSelectModel<typeof schema.offers>>().toEqualTypeOf<D.Offer>();
    expectTypeOf<InferSelectModel<typeof schema.activations>>().toEqualTypeOf<D.Activation>();
    expectTypeOf<InferSelectModel<typeof schema.networkTransactions>>().toEqualTypeOf<D.NetworkTransaction>();
    expectTypeOf<InferSelectModel<typeof schema.cashbacks>>().toEqualTypeOf<D.Cashback>();
    expectTypeOf<InferSelectModel<typeof schema.claims>>().toEqualTypeOf<D.Claim>();
    expectTypeOf<InferSelectModel<typeof schema.ledgerEntries>>().toEqualTypeOf<D.LedgerEntry>();
    expectTypeOf<InferSelectModel<typeof schema.payouts>>().toEqualTypeOf<D.Payout>();
    expectTypeOf<InferSelectModel<typeof schema.referrals>>().toEqualTypeOf<D.Referral>();
    expectTypeOf<InferSelectModel<typeof schema.auditLog>>().toEqualTypeOf<D.AuditEntry>();
    expectTypeOf<InferSelectModel<typeof schema.importBatches>>().toEqualTypeOf<D.ImportBatch>();
  });
});

describe("the margin report over the seed", () => {
  let db: Db;
  let close: () => Promise<void>;
  let data: SeedData;

  beforeAll(async () => {
    ({ db, close } = await connectPglite());
    data = await generateSeed();
    await seedDatabase(db, data);
  });
  afterAll(() => close());

  it("agrees with the same sums done by hand over the seed, merchant by merchant", async () => {
    const from = new Date("2026-09-01T00:00:00Z");
    const to = new Date("2026-10-01T00:00:00Z");
    const { ports } = drizzlePortsCreator(db);
    const lines = await ports.reports.margin(from, to);
    const byHand = new Map<string, { transactions: number; orderCents: number; commissionCents: number; cashbackCents: number }>();
    for (const tx of data.networkTransactions) {
      if (tx.orderedAt < from || tx.orderedAt >= to) continue;
      const line = byHand.get(tx.merchantId) ?? { transactions: 0, orderCents: 0, commissionCents: 0, cashbackCents: 0 };
      line.transactions++;
      line.orderCents += tx.orderCents;
      line.commissionCents += tx.commissionCents;
      const cb = data.cashbacks.find((c) => c.networkTransactionId === tx.id);
      if (cb && cb.status !== "refused") line.cashbackCents += cb.amountCents;
      byHand.set(tx.merchantId, line);
    }
    expect(lines.length).toBe(byHand.size);
    expect(lines.length).toBeGreaterThan(30);
    for (const line of lines) expect({ transactions: line.transactions, orderCents: line.orderCents, commissionCents: line.commissionCents, cashbackCents: line.cashbackCents }).toEqual(byHand.get(line.merchantId));
    expect(lines.every((l) => l.commissionCents >= l.cashbackCents)).toBe(true);
    const sorted = [...lines].sort((a, b) => b.commissionCents - a.commissionCents);
    expect(lines.map((l) => l.merchantId)).toEqual(sorted.map((l) => l.merchantId));
  });

  it("sums the cashback validated in a window the way the seed booked it", async () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-11-01T00:00:00Z");
    const { ports } = drizzlePortsCreator(db);
    const expected = data.cashbacks.filter((c) => c.status === "validated" && c.validatedAt && c.validatedAt >= from && c.validatedAt < to).reduce((n, c) => n + c.amountCents, 0);
    expect(expected).toBeGreaterThan(0);
    expect(await ports.reports.validatedCentsBetween(from, to)).toBe(expected);
  });
});
