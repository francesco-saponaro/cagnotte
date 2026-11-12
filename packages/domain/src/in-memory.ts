import type { Activation, AuditEntry, Cashback, Claim, LedgerEntry, Merchant, NetworkTransaction, Offer, OfferBoost, Payout, Referral, Session, User } from "./entities.js";
import type { Balances, Page, PageQuery, Ports, UnitOfWork } from "./ports.js";

/*
 * The ports over arrays. The default adapter in a test, and what the app's component tests use:
 * no database, no I/O. It follows the same contract test as the Drizzle adapters, so what a filter
 * or a sort means is the same in both.
 */

export interface MemoryStore {
  users: User[];
  sessions: Session[];
  merchants: Merchant[];
  offers: Offer[];
  offerBoosts: OfferBoost[];
  activations: Activation[];
  transactions: NetworkTransaction[];
  cashbacks: Cashback[];
  claims: Claim[];
  ledgerEntries: LedgerEntry[];
  payouts: Payout[];
  referrals: Referral[];
  auditLog: AuditEntry[];
}

export function emptyStore(): MemoryStore {
  return { users: [], sessions: [], merchants: [], offers: [], offerBoosts: [], activations: [], transactions: [], cashbacks: [], claims: [], ledgerEntries: [], payouts: [], referrals: [], auditLog: [] };
}

function paginate<T>(items: T[], query: PageQuery): Page<T> {
  const start = (query.page - 1) * query.pageSize;
  return { items: items.slice(start, start + query.pageSize), total: items.length, page: query.page, pageSize: query.pageSize };
}

const newestFirst = <T>(items: T[], at: (item: T) => Date, id: (item: T) => string): T[] =>
  [...items].sort((a, b) => at(b).getTime() - at(a).getTime() || id(b).localeCompare(id(a)));

function replace<T extends { id: string }>(items: T[], item: T): void {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) throw new Error(`no row ${item.id} to update`);
  items[i] = item;
}

export function inMemoryPortsCreator(initial: Partial<MemoryStore> = {}): { ports: Ports; unitOfWork: UnitOfWork; store: MemoryStore } {
  const store: MemoryStore = { ...emptyStore(), ...initial };
  const merchantOf = (merchantId: string): Merchant => {
    const m = store.merchants.find((x) => x.id === merchantId);
    if (!m) throw new Error(`no merchant ${merchantId}`);
    return m;
  };
  const withMerchant = (offer: Offer) => ({ ...offer, merchant: merchantOf(offer.merchantId) });
  const offerOf = (offerId: string) => {
    const o = store.offers.find((x) => x.id === offerId);
    if (!o) throw new Error(`no offer ${offerId}`);
    return withMerchant(o);
  };
  const memberOf = (userId: string) => {
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error(`no user ${userId}`);
    return { id: u.id, email: u.email, displayName: u.displayName };
  };

  const ports: Ports = {
    users: {
      findById: async (id) => store.users.find((u) => u.id === id) ?? null,
      findByEmail: async (email) => store.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
      findByReferralCode: async (code) => store.users.find((u) => u.referralCode === code) ?? null,
      insert: async (user) => {
        store.users.push(user);
      },
      countByRole: async (role) => store.users.filter((u) => u.role === role).length,
    },
    sessions: {
      insert: async (session) => {
        store.sessions.push(session);
      },
      findActive: async (id, now) => store.sessions.find((s) => s.id === id && s.expiresAt.getTime() > now.getTime()) ?? null,
      delete: async (id) => {
        store.sessions = store.sessions.filter((s) => s.id !== id);
      },
    },
    merchants: {
      findById: async (id) => store.merchants.find((m) => m.id === id) ?? null,
      findBySlug: async (slug) => store.merchants.find((m) => m.slug === slug) ?? null,
      list: async () => [...store.merchants].sort((a, b) => a.name.localeCompare(b.name)),
      insert: async (merchant) => {
        store.merchants.push(merchant);
      },
    },
    offers: {
      findById: async (id) => {
        const o = store.offers.find((x) => x.id === id);
        return o ? withMerchant(o) : null;
      },
      list: async (filter) => {
        const q = filter.q?.trim().toLowerCase();
        let items = store.offers.map(withMerchant).filter((o) => filter.statuses.includes(o.status));
        if (filter.merchantId) items = items.filter((o) => o.merchantId === filter.merchantId);
        if (filter.kind) items = items.filter((o) => o.kind === filter.kind);
        if (filter.category) items = items.filter((o) => o.merchant.category === filter.category);
        if (q) items = items.filter((o) => o.title.toLowerCase().includes(q) || o.merchant.name.toLowerCase().includes(q));
        items.sort((a, b) => {
          if (filter.sort === "rate") return b.rateBps - a.rateBps || b.fixedCents - a.fixedCents || a.id.localeCompare(b.id);
          if (filter.sort === "newest") return b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
          return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        });
        return paginate(items, filter);
      },
      insert: async (offer) => {
        store.offers.push(offer);
      },
      update: async (offer) => replace(store.offers, offer),
      countByStatus: async (status) => store.offers.filter((o) => o.status === status).length,
      boostsOf: async (offerId) => store.offerBoosts.filter((b) => b.offerId === offerId).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      insertBoost: async (boost) => {
        store.offerBoosts.push(boost);
      },
    },
    activations: {
      findById: async (id) => store.activations.find((a) => a.id === id) ?? null,
      insert: async (activation) => {
        store.activations.push(activation);
      },
      listByUser: async (userId, page) =>
        paginate(
          newestFirst(
            store.activations.filter((a) => a.userId === userId),
            (a) => a.activatedAt,
            (a) => a.id,
          ).map((a) => ({ ...a, offer: offerOf(a.offerId) })),
          page,
        ),
      latestBefore: async (userId, offerId, at) =>
        newestFirst(
          store.activations.filter((a) => a.userId === userId && a.offerId === offerId && a.activatedAt.getTime() <= at.getTime()),
          (a) => a.activatedAt,
          (a) => a.id,
        )[0] ?? null,
    },
    cashbacks: {
      findById: async (id) => {
        const c = store.cashbacks.find((x) => x.id === id);
        return c ? { ...c, offer: offerOf(c.offerId) } : null;
      },
      list: async (filter) => {
        let items = store.cashbacks;
        if (filter.userId) items = items.filter((c) => c.userId === filter.userId);
        if (filter.status) items = items.filter((c) => c.status === filter.status);
        return paginate(
          newestFirst(
            items,
            (c) => c.createdAt,
            (c) => c.id,
          ).map((c) => ({ ...c, offer: offerOf(c.offerId) })),
          filter,
        );
      },
      insert: async (cashback) => {
        store.cashbacks.push(cashback);
      },
      update: async (cashback) => replace(store.cashbacks, cashback),
      countByStatus: async (status) => store.cashbacks.filter((c) => c.status === status).length,
      sumByStatus: async (status) => store.cashbacks.filter((c) => c.status === status).reduce((n, c) => n + c.amountCents, 0),
    },
    claims: {
      findById: async (id) => {
        const c = store.claims.find((x) => x.id === id);
        return c ? { ...c, offer: offerOf(c.offerId), member: memberOf(c.userId) } : null;
      },
      list: async (filter) => {
        const q = filter.q?.trim().toLowerCase();
        let items = store.claims.map((c) => ({ ...c, offer: offerOf(c.offerId), member: memberOf(c.userId) }));
        if (filter.userId) items = items.filter((c) => c.userId === filter.userId);
        if (filter.status) items = items.filter((c) => c.status === filter.status);
        if (filter.assigneeId) items = items.filter((c) => c.assigneeId === filter.assigneeId);
        if (q) items = items.filter((c) => c.orderRef.toLowerCase().includes(q) || c.member.email.toLowerCase().includes(q));
        return paginate(
          newestFirst(
            items,
            (c) => c.filedAt,
            (c) => c.id,
          ),
          filter,
        );
      },
      insert: async (claim) => {
        store.claims.push(claim);
      },
      update: async (claim) => replace(store.claims, claim),
      countOpen: async () => store.claims.filter((c) => c.status !== "credited" && c.status !== "declined").length,
    },
    ledger: {
      insert: async (entries) => {
        store.ledgerEntries.push(...entries);
      },
      balances: async (userId) => {
        const b: Balances = { pending: 0, available: 0, reserved: 0, paid: 0 };
        for (const e of store.ledgerEntries) if (e.userId === userId) b[e.bucket] += e.amountCents;
        return b;
      },
      listByUser: async (userId, page) =>
        paginate(
          newestFirst(
            store.ledgerEntries.filter((e) => e.userId === userId),
            (e) => e.createdAt,
            (e) => e.id,
          ),
          page,
        ),
      listByRef: async (refType, refId) => store.ledgerEntries.filter((e) => e.refType === refType && e.refId === refId),
      sumByKind: async (userId, kind) => store.ledgerEntries.filter((e) => e.userId === userId && e.kind === kind).reduce((n, e) => n + e.amountCents, 0),
    },
    payouts: {
      findById: async (id) => store.payouts.find((x) => x.id === id) ?? null,
      list: async (filter) => {
        let items = store.payouts;
        if (filter.userId) items = items.filter((x) => x.userId === filter.userId);
        if (filter.status) items = items.filter((x) => x.status === filter.status);
        return paginate(
          newestFirst(
            items,
            (x) => x.requestedAt,
            (x) => x.id,
          ).map((x) => ({ ...x, member: memberOf(x.userId) })),
          filter,
        );
      },
      insert: async (payout) => {
        store.payouts.push(payout);
      },
      update: async (payout) => replace(store.payouts, payout),
      countByStatus: async (status) => store.payouts.filter((x) => x.status === status).length,
    },
    referrals: {
      findByReferee: async (refereeId) => store.referrals.find((r) => r.refereeId === refereeId) ?? null,
      listByReferrer: async (referrerId) =>
        store.referrals
          .filter((r) => r.referrerId === referrerId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((r) => {
            const referee = store.users.find((u) => u.id === r.refereeId);
            if (!referee) throw new Error(`no user ${r.refereeId}`);
            return { ...r, referee: { displayName: referee.displayName, createdAt: referee.createdAt } };
          }),
      countByReferrer: async (referrerId) => store.referrals.filter((r) => r.referrerId === referrerId).length,
      insert: async (referral) => {
        store.referrals.push(referral);
      },
      update: async (referral) => replace(store.referrals, referral),
    },
    transactions: {
      findById: async (id) => store.transactions.find((t) => t.id === id) ?? null,
      countByMatch: async (status) => store.transactions.filter((t) => t.matchStatus === status).length,
    },
    audit: {
      insert: async (entry) => {
        store.auditLog.push(entry);
      },
      list: async (filter) => {
        let items = store.auditLog;
        if (filter.entityType) items = items.filter((e) => e.entityType === filter.entityType);
        if (filter.entityId) items = items.filter((e) => e.entityId === filter.entityId);
        if (filter.actorId) items = items.filter((e) => e.actorId === filter.actorId);
        return paginate(
          newestFirst(
            items,
            (e) => e.at,
            (e) => e.id,
          ),
          filter,
        );
      },
    },
    reports: {
      margin: async (from, to) => {
        const lines = new Map<string, { merchantId: string; merchantName: string; transactions: number; orderCents: number; commissionCents: number; cashbackCents: number }>();
        for (const t of store.transactions) {
          if (t.orderedAt.getTime() < from.getTime() || t.orderedAt.getTime() >= to.getTime()) continue;
          const line = lines.get(t.merchantId) ?? { merchantId: t.merchantId, merchantName: merchantOf(t.merchantId).name, transactions: 0, orderCents: 0, commissionCents: 0, cashbackCents: 0 };
          line.transactions += 1;
          line.orderCents += t.orderCents;
          line.commissionCents += t.commissionCents;
          const cb = store.cashbacks.find((c) => c.networkTransactionId === t.id);
          if (cb && cb.status !== "refused") line.cashbackCents += cb.amountCents;
          lines.set(t.merchantId, line);
        }
        return [...lines.values()].sort((a, b) => b.commissionCents - a.commissionCents || a.merchantName.localeCompare(b.merchantName));
      },
      validatedCentsBetween: async (from, to) =>
        store.cashbacks
          .filter((c) => c.status === "validated" && c.validatedAt !== null && c.validatedAt.getTime() >= from.getTime() && c.validatedAt.getTime() < to.getTime())
          .reduce((n, c) => n + c.amountCents, 0),
    },
  };

  const unitOfWork: UnitOfWork = {
    // A snapshot of every array, restored if the work throws: the same promise the database makes.
    run: async (work) => {
      const snapshot = Object.fromEntries(Object.entries(store).map(([k, v]) => [k, [...(v as unknown[])]])) as unknown as MemoryStore;
      try {
        return await work(ports);
      } catch (e) {
        Object.assign(store, snapshot);
        throw e;
      }
    },
  };

  return { ports, unitOfWork, store };
}
