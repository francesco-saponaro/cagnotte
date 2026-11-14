import { cashbackNets, payoutNets, type Balances, type LedgerBucket, type MarginLine, type Page, type PageQuery, type Ports, type UnitOfWork } from "@cagnotte/domain";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, lte, or, sql, sum, type SQL } from "drizzle-orm";
import type { Db } from "./db.js";
import * as t from "./schema.js";

/*
 * The ports over Drizzle. The same code runs on node-postgres under docker compose and on PGlite in
 * the tests and in the browser demo; the contract test in `packages/domain` runs against both this
 * and the in-memory adapters, so a filter or a sort means the same thing everywhere.
 */

const offset = (page: PageQuery) => (page.page - 1) * page.pageSize;

async function paged<T>(page: PageQuery, items: Promise<T[]>, total: Promise<{ n: number }[]>): Promise<Page<T>> {
  const [rows, counted] = await Promise.all([items, total]);
  return { items: rows, total: counted[0]?.n ?? 0, page: page.page, pageSize: page.pageSize };
}

const offerColumns = { ...t.offers };
const merchantColumns = { ...t.merchants };

type OfferJoinRow = { offer: typeof t.offers.$inferSelect; merchant: typeof t.merchants.$inferSelect };
const withMerchant = (row: OfferJoinRow) => ({ ...row.offer, merchant: row.merchant });

const memberColumns = { id: t.users.id, email: t.users.email, displayName: t.users.displayName };

export function drizzlePortsCreator(db: Db): { ports: Ports; unitOfWork: UnitOfWork } {
  const offerQuery = () => db.select({ offer: offerColumns, merchant: merchantColumns }).from(t.offers).innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id));

  const ports: Ports = {
    users: {
      findById: async (id) => (await db.select().from(t.users).where(eq(t.users.id, id)))[0] ?? null,
      findByEmail: async (email) => (await db.select().from(t.users).where(eq(sql`lower(${t.users.email})`, email.toLowerCase())))[0] ?? null,
      findByReferralCode: async (code) => (await db.select().from(t.users).where(eq(t.users.referralCode, code)))[0] ?? null,
      insert: async (user) => {
        await db.insert(t.users).values(user);
      },
      countByRole: async (role) => (await db.select({ n: count() }).from(t.users).where(eq(t.users.role, role)))[0]?.n ?? 0,
    },
    sessions: {
      insert: async (session) => {
        await db.insert(t.sessions).values(session);
      },
      findActive: async (id, now) => (await db.select().from(t.sessions).where(and(eq(t.sessions.id, id), gt(t.sessions.expiresAt, now))))[0] ?? null,
      delete: async (id) => {
        await db.delete(t.sessions).where(eq(t.sessions.id, id));
      },
    },
    merchants: {
      findById: async (id) => (await db.select().from(t.merchants).where(eq(t.merchants.id, id)))[0] ?? null,
      findBySlug: async (slug) => (await db.select().from(t.merchants).where(eq(t.merchants.slug, slug)))[0] ?? null,
      list: () => db.select().from(t.merchants).orderBy(asc(sql`lower(${t.merchants.name})`), asc(t.merchants.id)),
      insert: async (merchant) => {
        await db.insert(t.merchants).values(merchant);
      },
      findByAdvertiser: async (network, advertiserRef) => (await db.select().from(t.merchants).where(and(eq(t.merchants.network, network), eq(t.merchants.advertiserRef, advertiserRef))))[0] ?? null,
    },
    offers: {
      findById: async (id) => {
        const row = (await offerQuery().where(eq(t.offers.id, id)))[0];
        return row ? withMerchant(row) : null;
      },
      list: async (filter) => {
        const q = filter.q?.trim();
        const where = and(
          sql`${t.offers.status} in ${filter.statuses}`,
          filter.merchantId ? eq(t.offers.merchantId, filter.merchantId) : undefined,
          filter.kind ? eq(t.offers.kind, filter.kind) : undefined,
          filter.category ? eq(t.merchants.category, filter.category) : undefined,
          q ? or(ilike(t.offers.title, `%${q}%`), ilike(t.merchants.name, `%${q}%`)) : undefined,
        );
        const order: SQL[] =
          filter.sort === "rate"
            ? [desc(t.offers.rateBps), desc(t.offers.fixedCents), asc(t.offers.id)]
            : filter.sort === "newest"
              ? [desc(t.offers.createdAt), desc(t.offers.id)]
              : [asc(sql`lower(${t.offers.title})`), asc(t.offers.id)];
        return paged(
          filter,
          offerQuery()
            .where(where)
            .orderBy(...order)
            .limit(filter.pageSize)
            .offset(offset(filter))
            .then((rows) => rows.map(withMerchant)),
          db.select({ n: count() }).from(t.offers).innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id)).where(where),
        );
      },
      insert: async (offer) => {
        await db.insert(t.offers).values(offer);
      },
      update: async (offer) => {
        await db.update(t.offers).set(offer).where(eq(t.offers.id, offer.id));
      },
      countByStatus: async (status) => (await db.select({ n: count() }).from(t.offers).where(eq(t.offers.status, status)))[0]?.n ?? 0,
      boostsOf: (offerId) => db.select().from(t.offerBoosts).where(eq(t.offerBoosts.offerId, offerId)).orderBy(asc(t.offerBoosts.startsAt), asc(t.offerBoosts.id)),
      insertBoost: async (boost) => {
        await db.insert(t.offerBoosts).values(boost);
      },
    },
    activations: {
      findById: async (id) => (await db.select().from(t.activations).where(eq(t.activations.id, id)))[0] ?? null,
      insert: async (activation) => {
        await db.insert(t.activations).values(activation);
      },
      listByUser: (userId, page) =>
        paged(
          page,
          db
            .select({ activation: { ...t.activations }, offer: offerColumns, merchant: merchantColumns })
            .from(t.activations)
            .innerJoin(t.offers, eq(t.activations.offerId, t.offers.id))
            .innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id))
            .where(eq(t.activations.userId, userId))
            .orderBy(desc(t.activations.activatedAt), desc(t.activations.id))
            .limit(page.pageSize)
            .offset(offset(page))
            .then((rows) => rows.map((r) => ({ ...r.activation, offer: { ...r.offer, merchant: r.merchant } }))),
          db.select({ n: count() }).from(t.activations).where(eq(t.activations.userId, userId)),
        ),
      latestBefore: async (userId, offerId, at) =>
        (
          await db
            .select()
            .from(t.activations)
            .where(and(eq(t.activations.userId, userId), eq(t.activations.offerId, offerId), lte(t.activations.activatedAt, at)))
            .orderBy(desc(t.activations.activatedAt), desc(t.activations.id))
            .limit(1)
        )[0] ?? null,
      findBySubId: async (subId) => {
        const row = (await db.select({ activation: { ...t.activations }, offer: offerColumns, merchant: merchantColumns }).from(t.activations).innerJoin(t.offers, eq(t.activations.offerId, t.offers.id)).innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id)).where(eq(t.activations.subId, subId)))[0];
        return row ? { ...row.activation, offer: { ...row.offer, merchant: row.merchant } } : null;
      },
      atMerchantBetween: (merchantId, from, to) =>
        db
          .select({ activation: { ...t.activations }, offer: offerColumns, merchant: merchantColumns, member: memberColumns })
          .from(t.activations)
          .innerJoin(t.offers, eq(t.activations.offerId, t.offers.id))
          .innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id))
          .innerJoin(t.users, eq(t.activations.userId, t.users.id))
          .where(and(eq(t.offers.merchantId, merchantId), gte(t.activations.activatedAt, from), lte(t.activations.activatedAt, to)))
          .orderBy(asc(t.activations.activatedAt), asc(t.activations.id))
          .then((rows) => rows.map((r) => ({ ...r.activation, offer: { ...r.offer, merchant: r.merchant }, member: r.member }))),
    },
    cashbacks: {
      findById: async (id) => {
        const row = (await db.select({ cashback: { ...t.cashbacks }, offer: offerColumns, merchant: merchantColumns }).from(t.cashbacks).innerJoin(t.offers, eq(t.cashbacks.offerId, t.offers.id)).innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id)).where(eq(t.cashbacks.id, id)))[0];
        return row ? { ...row.cashback, offer: { ...row.offer, merchant: row.merchant } } : null;
      },
      list: (filter) => {
        const where = and(filter.userId ? eq(t.cashbacks.userId, filter.userId) : undefined, filter.status ? eq(t.cashbacks.status, filter.status) : undefined);
        return paged(
          filter,
          db
            .select({ cashback: { ...t.cashbacks }, offer: offerColumns, merchant: merchantColumns })
            .from(t.cashbacks)
            .innerJoin(t.offers, eq(t.cashbacks.offerId, t.offers.id))
            .innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id))
            .where(where)
            .orderBy(desc(t.cashbacks.createdAt), desc(t.cashbacks.id))
            .limit(filter.pageSize)
            .offset(offset(filter))
            .then((rows) => rows.map((r) => ({ ...r.cashback, offer: { ...r.offer, merchant: r.merchant } }))),
          db.select({ n: count() }).from(t.cashbacks).where(where),
        );
      },
      insert: async (cashback) => {
        await db.insert(t.cashbacks).values(cashback);
      },
      update: async (cashback) => {
        await db.update(t.cashbacks).set(cashback).where(eq(t.cashbacks.id, cashback.id));
      },
      countByStatus: async (status) => (await db.select({ n: count() }).from(t.cashbacks).where(eq(t.cashbacks.status, status)))[0]?.n ?? 0,
      sumByStatus: async (status) => Number((await db.select({ s: sum(t.cashbacks.amountCents) }).from(t.cashbacks).where(eq(t.cashbacks.status, status)))[0]?.s ?? 0),
      findByActivation: async (activationId) => (await db.select().from(t.cashbacks).where(eq(t.cashbacks.activationId, activationId)))[0] ?? null,
      findByTransaction: async (transactionId) => (await db.select().from(t.cashbacks).where(eq(t.cashbacks.networkTransactionId, transactionId)))[0] ?? null,
      hasValidatedAt: async (userId, merchantId) =>
        ((await db.select({ n: count() }).from(t.cashbacks).innerJoin(t.offers, eq(t.cashbacks.offerId, t.offers.id)).where(and(eq(t.cashbacks.userId, userId), eq(t.cashbacks.status, "validated"), eq(t.offers.merchantId, merchantId))))[0]?.n ?? 0) > 0,
      validatedCentsOf: async (userId) =>
        Number((await db.select({ s: sum(t.cashbacks.amountCents) }).from(t.cashbacks).where(and(eq(t.cashbacks.userId, userId), eq(t.cashbacks.status, "validated"), sql`${t.cashbacks.decidedBy} is distinct from 'claim'`)))[0]?.s ?? 0),
    },
    claims: {
      findById: async (id) => {
        const row = (await db.select({ claim: { ...t.claims }, offer: offerColumns, merchant: merchantColumns, member: memberColumns }).from(t.claims).innerJoin(t.offers, eq(t.claims.offerId, t.offers.id)).innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id)).innerJoin(t.users, eq(t.claims.userId, t.users.id)).where(eq(t.claims.id, id)))[0];
        return row ? { ...row.claim, offer: { ...row.offer, merchant: row.merchant }, member: row.member } : null;
      },
      list: (filter) => {
        const q = filter.q?.trim();
        const where = and(
          filter.userId ? eq(t.claims.userId, filter.userId) : undefined,
          filter.status ? eq(t.claims.status, filter.status) : undefined,
          filter.assigneeId ? eq(t.claims.assigneeId, filter.assigneeId) : undefined,
          q ? or(ilike(t.claims.orderRef, `%${q}%`), ilike(t.users.email, `%${q}%`)) : undefined,
        );
        return paged(
          filter,
          db
            .select({ claim: { ...t.claims }, offer: offerColumns, merchant: merchantColumns, member: memberColumns })
            .from(t.claims)
            .innerJoin(t.offers, eq(t.claims.offerId, t.offers.id))
            .innerJoin(t.merchants, eq(t.offers.merchantId, t.merchants.id))
            .innerJoin(t.users, eq(t.claims.userId, t.users.id))
            .where(where)
            .orderBy(desc(t.claims.filedAt), desc(t.claims.id))
            .limit(filter.pageSize)
            .offset(offset(filter))
            .then((rows) => rows.map((r) => ({ ...r.claim, offer: { ...r.offer, merchant: r.merchant }, member: r.member }))),
          db.select({ n: count() }).from(t.claims).innerJoin(t.users, eq(t.claims.userId, t.users.id)).where(where),
        );
      },
      insert: async (claim) => {
        await db.insert(t.claims).values(claim);
      },
      update: async (claim) => {
        await db.update(t.claims).set(claim).where(eq(t.claims.id, claim.id));
      },
      countOpen: async () => (await db.select({ n: count() }).from(t.claims).where(sql`${t.claims.status} not in ('credited', 'declined')`))[0]?.n ?? 0,
    },
    ledger: {
      insert: async (entries) => {
        if (entries.length > 0) await db.insert(t.ledgerEntries).values(entries);
      },
      balances: async (userId) => {
        const rows = await db.select({ bucket: t.ledgerEntries.bucket, s: sum(t.ledgerEntries.amountCents) }).from(t.ledgerEntries).where(eq(t.ledgerEntries.userId, userId)).groupBy(t.ledgerEntries.bucket);
        const balances: Balances = { pending: 0, available: 0, reserved: 0, paid: 0 };
        for (const row of rows) balances[row.bucket as LedgerBucket] = Number(row.s ?? 0);
        return balances;
      },
      listByUser: (userId, page) =>
        paged(
          page,
          db.select().from(t.ledgerEntries).where(eq(t.ledgerEntries.userId, userId)).orderBy(desc(t.ledgerEntries.createdAt), desc(t.ledgerEntries.id)).limit(page.pageSize).offset(offset(page)),
          db.select({ n: count() }).from(t.ledgerEntries).where(eq(t.ledgerEntries.userId, userId)),
        ),
      listByRef: (refType, refId) => db.select().from(t.ledgerEntries).where(and(eq(t.ledgerEntries.refType, refType), eq(t.ledgerEntries.refId, refId))).orderBy(asc(t.ledgerEntries.createdAt), asc(t.ledgerEntries.id)),
      sumByKind: async (userId, kind) => Number((await db.select({ s: sum(t.ledgerEntries.amountCents) }).from(t.ledgerEntries).where(and(eq(t.ledgerEntries.userId, userId), eq(t.ledgerEntries.kind, kind))))[0]?.s ?? 0),
    },
    payouts: {
      findById: async (id) => (await db.select().from(t.payouts).where(eq(t.payouts.id, id)))[0] ?? null,
      list: (filter) => {
        const where = and(filter.userId ? eq(t.payouts.userId, filter.userId) : undefined, filter.status ? eq(t.payouts.status, filter.status) : undefined);
        return paged(
          filter,
          db
            .select({ payout: { ...t.payouts }, member: memberColumns })
            .from(t.payouts)
            .innerJoin(t.users, eq(t.payouts.userId, t.users.id))
            .where(where)
            .orderBy(desc(t.payouts.requestedAt), desc(t.payouts.id))
            .limit(filter.pageSize)
            .offset(offset(filter))
            .then((rows) => rows.map((r) => ({ ...r.payout, member: r.member }))),
          db.select({ n: count() }).from(t.payouts).where(where),
        );
      },
      insert: async (payout) => {
        await db.insert(t.payouts).values(payout);
      },
      update: async (payout) => {
        await db.update(t.payouts).set(payout).where(eq(t.payouts.id, payout.id));
      },
      countByStatus: async (status) => (await db.select({ n: count() }).from(t.payouts).where(eq(t.payouts.status, status)))[0]?.n ?? 0,
    },
    referrals: {
      findByReferee: async (refereeId) => (await db.select().from(t.referrals).where(eq(t.referrals.refereeId, refereeId)))[0] ?? null,
      listByReferrer: (referrerId) =>
        db
          .select({ referral: { ...t.referrals }, referee: { displayName: t.users.displayName, createdAt: t.users.createdAt } })
          .from(t.referrals)
          .innerJoin(t.users, eq(t.referrals.refereeId, t.users.id))
          .where(eq(t.referrals.referrerId, referrerId))
          .orderBy(desc(t.referrals.createdAt), desc(t.referrals.id))
          .then((rows) => rows.map((r) => ({ ...r.referral, referee: r.referee }))),
      countByReferrer: async (referrerId) => (await db.select({ n: count() }).from(t.referrals).where(eq(t.referrals.referrerId, referrerId)))[0]?.n ?? 0,
      insert: async (referral) => {
        await db.insert(t.referrals).values(referral);
      },
      update: async (referral) => {
        await db.update(t.referrals).set(referral).where(eq(t.referrals.id, referral.id));
      },
    },
    imports: {
      findById: async (id) => (await db.select().from(t.importBatches).where(eq(t.importBatches.id, id)))[0] ?? null,
      list: (page) =>
        paged(
          page,
          db.select().from(t.importBatches).orderBy(desc(t.importBatches.createdAt), desc(t.importBatches.id)).limit(page.pageSize).offset(offset(page)),
          db.select({ n: count() }).from(t.importBatches),
        ),
      insert: async (batch) => {
        await db.insert(t.importBatches).values(batch);
      },
      update: async (batch) => {
        await db.update(t.importBatches).set(batch).where(eq(t.importBatches.id, batch.id));
      },
    },
    transactions: {
      findById: async (id) => {
        const row = (await db.select({ transaction: { ...t.networkTransactions }, merchant: merchantColumns }).from(t.networkTransactions).innerJoin(t.merchants, eq(t.networkTransactions.merchantId, t.merchants.id)).where(eq(t.networkTransactions.id, id)))[0];
        return row ? { ...row.transaction, merchant: row.merchant } : null;
      },
      findByRef: async (network, networkRef) => (await db.select().from(t.networkTransactions).where(and(eq(t.networkTransactions.network, network), eq(t.networkTransactions.networkRef, networkRef))))[0] ?? null,
      list: (filter) => {
        const where = and(
          filter.matchStatus ? eq(t.networkTransactions.matchStatus, filter.matchStatus) : undefined,
          filter.network ? eq(t.networkTransactions.network, filter.network) : undefined,
          filter.merchantId ? eq(t.networkTransactions.merchantId, filter.merchantId) : undefined,
          filter.batchId ? eq(t.networkTransactions.batchId, filter.batchId) : undefined,
        );
        return paged(
          filter,
          db
            .select({ transaction: { ...t.networkTransactions }, merchant: merchantColumns })
            .from(t.networkTransactions)
            .innerJoin(t.merchants, eq(t.networkTransactions.merchantId, t.merchants.id))
            .where(where)
            .orderBy(desc(t.networkTransactions.reportedAt), desc(t.networkTransactions.id))
            .limit(filter.pageSize)
            .offset(offset(filter))
            .then((rows) => rows.map((r) => ({ ...r.transaction, merchant: r.merchant }))),
          db.select({ n: count() }).from(t.networkTransactions).where(where),
        );
      },
      insert: async (transaction) => {
        await db.insert(t.networkTransactions).values(transaction);
      },
      update: async (transaction) => {
        await db.update(t.networkTransactions).set(transaction).where(eq(t.networkTransactions.id, transaction.id));
      },
      countByMatch: async (status) => (await db.select({ n: count() }).from(t.networkTransactions).where(eq(t.networkTransactions.matchStatus, status)))[0]?.n ?? 0,
    },
    audit: {
      insert: async (entry) => {
        await db.insert(t.auditLog).values(entry);
      },
      list: (filter) => {
        const where = and(
          filter.entityType ? eq(t.auditLog.entityType, filter.entityType) : undefined,
          filter.entityId ? eq(t.auditLog.entityId, filter.entityId) : undefined,
          filter.actorId ? eq(t.auditLog.actorId, filter.actorId) : undefined,
        );
        return paged(
          filter,
          db.select().from(t.auditLog).where(where).orderBy(desc(t.auditLog.at), desc(t.auditLog.id)).limit(filter.pageSize).offset(offset(filter)),
          db.select({ n: count() }).from(t.auditLog).where(where),
        );
      },
    },
    reports: {
      margin: async (from, to) => {
        // Cashback out: the amount of the cashback booked for each transaction, unless it was refused.
        const rows = await db
          .select({
            merchantId: t.merchants.id,
            merchantName: t.merchants.name,
            transactions: count(t.networkTransactions.id),
            orderCents: sum(t.networkTransactions.orderCents),
            commissionCents: sum(t.networkTransactions.commissionCents),
            cashbackCents: sql<string>`coalesce(sum(case when ${t.cashbacks.status} is null or ${t.cashbacks.status} = 'refused' then 0 else ${t.cashbacks.amountCents} end), 0)`,
          })
          .from(t.networkTransactions)
          .innerJoin(t.merchants, eq(t.networkTransactions.merchantId, t.merchants.id))
          .leftJoin(t.cashbacks, eq(t.cashbacks.networkTransactionId, t.networkTransactions.id))
          .where(and(gte(t.networkTransactions.orderedAt, from), lt(t.networkTransactions.orderedAt, to)))
          .groupBy(t.merchants.id, t.merchants.name);
        const lines: MarginLine[] = rows.map((r) => ({ merchantId: r.merchantId, merchantName: r.merchantName, transactions: r.transactions, orderCents: Number(r.orderCents ?? 0), commissionCents: Number(r.commissionCents ?? 0), cashbackCents: Number(r.cashbackCents) }));
        return lines.sort((a, b) => b.commissionCents - a.commissionCents || a.merchantName.toLowerCase().localeCompare(b.merchantName.toLowerCase()));
      },
      validatedCentsBetween: async (from, to) =>
        Number((await db.select({ s: sum(t.cashbacks.amountCents) }).from(t.cashbacks).where(and(eq(t.cashbacks.status, "validated"), gte(t.cashbacks.validatedAt, from), lt(t.cashbacks.validatedAt, to))))[0]?.s ?? 0),
      bucketTotals: async () => {
        const rows = await db.select({ bucket: t.ledgerEntries.bucket, s: sum(t.ledgerEntries.amountCents) }).from(t.ledgerEntries).groupBy(t.ledgerEntries.bucket);
        const totals: Balances = { pending: 0, available: 0, reserved: 0, paid: 0 };
        for (const row of rows) totals[row.bucket as LedgerBucket] = Number(row.s ?? 0);
        return totals;
      },
      ledgerTotalByKind: async (kind) => Number((await db.select({ s: sum(t.ledgerEntries.amountCents) }).from(t.ledgerEntries).where(eq(t.ledgerEntries.kind, kind)))[0]?.s ?? 0),
      negativeBalances: async () => {
        const rows = await db
          .select({ userId: t.ledgerEntries.userId, bucket: t.ledgerEntries.bucket, s: sum(t.ledgerEntries.amountCents) })
          .from(t.ledgerEntries)
          .groupBy(t.ledgerEntries.userId, t.ledgerEntries.bucket)
          .having(sql`sum(${t.ledgerEntries.amountCents}) < 0`)
          .orderBy(asc(t.ledgerEntries.userId), asc(t.ledgerEntries.bucket));
        return rows.map((r) => ({ userId: r.userId, bucket: r.bucket as LedgerBucket, amountCents: Number(r.s ?? 0) }));
      },
      // The entries of every cashback summed per bucket, next to the cashback's own status and amount; the rule
      // itself (`cashbackNets`) lives in the domain, so the SQL only gathers the numbers.
      cashbacksOutOfBalance: async () => {
        const rows = await db
          .select({
            id: t.cashbacks.id,
            status: t.cashbacks.status,
            amountCents: t.cashbacks.amountCents,
            pending: sql<string>`coalesce(sum(case when ${t.ledgerEntries.bucket} = 'pending' then ${t.ledgerEntries.amountCents} end), 0)`,
            available: sql<string>`coalesce(sum(case when ${t.ledgerEntries.bucket} = 'available' then ${t.ledgerEntries.amountCents} end), 0)`,
          })
          .from(t.cashbacks)
          .leftJoin(t.ledgerEntries, and(eq(t.ledgerEntries.refType, "cashback"), eq(t.ledgerEntries.refId, t.cashbacks.id)))
          .groupBy(t.cashbacks.id, t.cashbacks.status, t.cashbacks.amountCents)
          .orderBy(asc(t.cashbacks.id));
        return rows.filter((r) => {
          const expected = cashbackNets(r.status, r.amountCents);
          return Number(r.pending) !== expected.pending || Number(r.available) !== expected.available;
        }).map((r) => r.id);
      },
      payoutsOutOfBalance: async () => {
        const rows = await db
          .select({
            id: t.payouts.id,
            status: t.payouts.status,
            amountCents: t.payouts.amountCents,
            available: sql<string>`coalesce(sum(case when ${t.ledgerEntries.bucket} = 'available' then ${t.ledgerEntries.amountCents} end), 0)`,
            reserved: sql<string>`coalesce(sum(case when ${t.ledgerEntries.bucket} = 'reserved' then ${t.ledgerEntries.amountCents} end), 0)`,
            paid: sql<string>`coalesce(sum(case when ${t.ledgerEntries.bucket} = 'paid' then ${t.ledgerEntries.amountCents} end), 0)`,
          })
          .from(t.payouts)
          .leftJoin(t.ledgerEntries, and(eq(t.ledgerEntries.refType, "payout"), eq(t.ledgerEntries.refId, t.payouts.id)))
          .groupBy(t.payouts.id, t.payouts.status, t.payouts.amountCents)
          .orderBy(asc(t.payouts.id));
        return rows.filter((r) => {
          const expected = payoutNets(r.status, r.amountCents);
          return Number(r.available) !== expected.available || Number(r.reserved) !== expected.reserved || Number(r.paid) !== expected.paid;
        }).map((r) => r.id);
      },
    },
  };

  const unitOfWork: UnitOfWork = {
    run: (work) => db.transaction((tx) => work(drizzlePortsCreator(tx).ports)),
  };

  return { ports, unitOfWork };
}
