import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activation, AuditEntry, Cashback, Claim, LedgerEntry, Merchant, Offer, OfferBoost, Payout, Ports, Referral, Session, UnitOfWork, User } from "../src/index.js";

/*
 * The behaviour every implementation of the ports must have. The in-memory adapters run it here;
 * `packages/postgres` runs the same file against the Drizzle adapters on PGlite, so the two can
 * never drift apart in what a filter, a sort or a sum means.
 */

export interface PortsUnderTest {
  ports: Ports;
  unitOfWork: UnitOfWork;
  close: () => Promise<void>;
}

const at = (iso: string) => new Date(iso);
const T0 = at("2026-10-01T10:00:00Z");

const user = (id: string, role: User["role"] = "member", extra: Partial<User> = {}): User => ({
  id,
  email: `${id}@example.com`,
  passwordHash: "x",
  displayName: id.toUpperCase(),
  role,
  referralCode: id,
  referredBy: null,
  createdAt: T0,
  ...extra,
});

const merchant = (id: string, extra: Partial<Merchant> = {}): Merchant => ({
  id,
  slug: id,
  name: id,
  category: "fashion",
  country: "FR",
  attributionDays: 30,
  network: "linkpool",
  advertiserRef: `adv-${id}`,
  ...extra,
});

const offer = (id: string, merchantId: string, extra: Partial<Offer> = {}): Offer => ({
  id,
  merchantId,
  kind: "online",
  title: id,
  description: "",
  rateKind: "percent",
  rateBps: 500,
  fixedCents: 0,
  minSpendCents: 0,
  newCustomersOnly: false,
  capCents: null,
  validationDays: 30,
  status: "live",
  startsAt: T0,
  endsAt: null,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

const activation = (id: string, userId: string, offerId: string, activatedAt: Date): Activation => ({
  id,
  userId,
  offerId,
  subId: `sub${id}`.padEnd(16, "0"),
  rateBps: 500,
  boosted: false,
  activatedAt,
  trackingUrl: "https://track.example/go",
});

const cashback = (id: string, userId: string, offerId: string, extra: Partial<Cashback> = {}): Cashback => ({
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
  expectedValidationAt: at("2026-11-01T00:00:00Z"),
  validatedAt: null,
  decidedAt: null,
  createdAt: T0,
  ...extra,
});

const claim = (id: string, userId: string, offerId: string, extra: Partial<Claim> = {}): Claim => ({
  id,
  userId,
  offerId,
  orderRef: `ORD-${id}`,
  orderedAt: T0,
  orderCents: 5000,
  proofText: "proof",
  status: "filed",
  assigneeId: null,
  networkTransactionId: null,
  cashbackId: null,
  declineReason: null,
  filedAt: T0,
  updatedAt: T0,
  ...extra,
});

const entry = (id: string, userId: string, bucket: LedgerEntry["bucket"], amountCents: number, createdAt = T0): LedgerEntry => ({
  id,
  userId,
  kind: amountCents > 0 ? "cashback_pending" : "cashback_refused",
  bucket,
  amountCents,
  refType: "cashback",
  refId: "cb_x",
  note: null,
  createdBy: null,
  createdAt,
});

const payout = (id: string, userId: string, extra: Partial<Payout> = {}): Payout => ({
  id,
  userId,
  method: "transfer",
  amountCents: 2000,
  destination: "FR76 •••• 1234",
  status: "requested",
  requestedAt: T0,
  checkedAt: null,
  sentAt: null,
  failedReason: null,
  ...extra,
});

export function describePorts(name: string, create: () => Promise<PortsUnderTest>): void {
  describe(`${name} ports`, () => {
    let p: Ports;
    let uow: UnitOfWork;
    let close: () => Promise<void>;

    beforeAll(async () => {
      ({ ports: p, unitOfWork: uow, close } = await create());
      await p.users.insert(user("u1"));
      await p.users.insert(user("u2", "member", { email: "Second@Example.com", referralCode: "second7" }));
      await p.users.insert(user("staff", "agent"));
      await p.merchants.insert(merchant("m1", { category: "fashion" }));
      await p.merchants.insert(merchant("m2", { category: "tech", name: "Zed Tech" }));
      await p.offers.insert(offer("o1", "m1", { rateBps: 300, title: "Alpha", createdAt: at("2026-10-01T00:00:00Z") }));
      await p.offers.insert(offer("o2", "m1", { rateBps: 900, title: "Bravo", status: "paused", createdAt: at("2026-10-02T00:00:00Z") }));
      await p.offers.insert(offer("o3", "m2", { rateBps: 600, title: "Charlie", kind: "voucher", createdAt: at("2026-10-03T00:00:00Z") }));
      await p.offers.insert(offer("o4", "m2", { rateBps: 100, title: "Delta draft", status: "draft", createdAt: at("2026-10-04T00:00:00Z") }));
    });
    afterAll(() => close());

    describe("users and sessions", () => {
      it("find a user by id, by email case-insensitively, and by referral code", async () => {
        expect((await p.users.findById("u1"))?.email).toBe("u1@example.com");
        expect((await p.users.findByEmail("second@example.com"))?.id).toBe("u2");
        expect((await p.users.findByEmail("nobody@example.com"))).toBeNull();
        expect((await p.users.findByReferralCode("second7"))?.id).toBe("u2");
        expect(await p.users.countByRole("member")).toBe(2);
        expect(await p.users.countByRole("manager")).toBe(0);
      });

      it("keep a session until it expires and forget it on delete", async () => {
        const s: Session = { id: "sess1", userId: "u1", createdAt: T0, expiresAt: at("2026-10-02T10:00:00Z") };
        await p.sessions.insert(s);
        expect((await p.sessions.findActive("sess1", at("2026-10-02T09:59:00Z")))?.userId).toBe("u1");
        expect(await p.sessions.findActive("sess1", at("2026-10-02T10:00:00Z"))).toBeNull();
        await p.sessions.delete("sess1");
        expect(await p.sessions.findActive("sess1", T0)).toBeNull();
      });
    });

    describe("merchants and offers", () => {
      it("list merchants by name and find one by slug", async () => {
        expect((await p.merchants.list()).map((m) => m.id)).toEqual(["m1", "m2"]);
        expect((await p.merchants.findBySlug("m2"))?.name).toBe("Zed Tech");
      });

      it("return an offer with its merchant", async () => {
        const o = await p.offers.findById("o3");
        expect(o?.merchant.name).toBe("Zed Tech");
        expect(await p.offers.findById("nope")).toBeNull();
      });

      it("filter offers by status, merchant, kind, category and text", async () => {
        const base = { statuses: ["live", "paused"] as const, sort: "name" as const, page: 1, pageSize: 10 };
        expect((await p.offers.list({ ...base })).items.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
        expect((await p.offers.list({ ...base, statuses: ["live"] })).items.map((o) => o.id)).toEqual(["o1", "o3"]);
        expect((await p.offers.list({ ...base, merchantId: "m2" })).items.map((o) => o.id)).toEqual(["o3"]);
        expect((await p.offers.list({ ...base, kind: "voucher" })).items.map((o) => o.id)).toEqual(["o3"]);
        expect((await p.offers.list({ ...base, category: "fashion" })).items.map((o) => o.id)).toEqual(["o1", "o2"]);
        expect((await p.offers.list({ ...base, q: "zed" })).items.map((o) => o.id)).toEqual(["o3"]);
        expect((await p.offers.list({ ...base, q: "BRAV" })).items.map((o) => o.id)).toEqual(["o2"]);
      });

      it("sort offers by rate, newest and name, and page them with a total", async () => {
        const base = { statuses: ["live", "paused", "draft"] as const, page: 1, pageSize: 2 };
        const byRate = await p.offers.list({ ...base, sort: "rate" });
        expect(byRate.items.map((o) => o.id)).toEqual(["o2", "o3"]);
        expect(byRate.total).toBe(4);
        expect(byRate.pageSize).toBe(2);
        expect((await p.offers.list({ ...base, sort: "rate", page: 2 })).items.map((o) => o.id)).toEqual(["o1", "o4"]);
        expect((await p.offers.list({ ...base, sort: "newest" })).items.map((o) => o.id)).toEqual(["o4", "o3"]);
        expect((await p.offers.list({ ...base, sort: "name" })).items.map((o) => o.id)).toEqual(["o1", "o2"]);
      });

      it("update an offer and count by status", async () => {
        const o = (await p.offers.findById("o4"))!;
        await p.offers.update({ ...o, status: "live", title: "Delta" });
        expect((await p.offers.findById("o4"))?.title).toBe("Delta");
        expect(await p.offers.countByStatus("live")).toBe(3);
        await p.offers.update({ ...o, status: "draft" });
      });

      it("keep boosts per offer in start order", async () => {
        const b = (id: string, startsAt: string, endsAt: string): OfferBoost => ({ id, offerId: "o1", rateBps: 800, startsAt: at(startsAt), endsAt: at(endsAt), createdBy: "staff" });
        await p.offers.insertBoost(b("b2", "2026-11-01T00:00:00Z", "2026-11-05T00:00:00Z"));
        await p.offers.insertBoost(b("b1", "2026-10-10T00:00:00Z", "2026-10-12T00:00:00Z"));
        expect((await p.offers.boostsOf("o1")).map((x) => x.id)).toEqual(["b1", "b2"]);
        expect(await p.offers.boostsOf("o2")).toEqual([]);
      });
    });

    describe("activations", () => {
      beforeAll(async () => {
        await p.activations.insert(activation("a1", "u1", "o1", at("2026-10-05T10:00:00Z")));
        await p.activations.insert(activation("a2", "u1", "o1", at("2026-10-08T10:00:00Z")));
        await p.activations.insert(activation("a3", "u1", "o3", at("2026-10-09T10:00:00Z")));
        await p.activations.insert(activation("a4", "u2", "o1", at("2026-10-09T10:00:00Z")));
      });

      it("list a member's activations newest first with the offer and merchant", async () => {
        const page = await p.activations.listByUser("u1", { page: 1, pageSize: 2 });
        expect(page.items.map((a) => a.id)).toEqual(["a3", "a2"]);
        expect(page.items[0]?.offer.merchant.id).toBe("m2");
        expect(page.total).toBe(3);
      });

      it("find the latest activation of an offer before an instant, for the same member only", async () => {
        expect((await p.activations.latestBefore("u1", "o1", at("2026-10-08T12:00:00Z")))?.id).toBe("a2");
        expect((await p.activations.latestBefore("u1", "o1", at("2026-10-06T00:00:00Z")))?.id).toBe("a1");
        expect(await p.activations.latestBefore("u1", "o1", at("2026-10-01T00:00:00Z"))).toBeNull();
        expect(await p.activations.latestBefore("u2", "o3", at("2026-12-01T00:00:00Z"))).toBeNull();
        expect((await p.activations.findById("a4"))?.userId).toBe("u2");
      });
    });

    describe("cashbacks", () => {
      beforeAll(async () => {
        await p.cashbacks.insert(cashback("c1", "u1", "o1", { createdAt: at("2026-10-06T00:00:00Z") }));
        await p.cashbacks.insert(cashback("c2", "u1", "o3", { status: "validated", amountCents: 700, createdAt: at("2026-10-07T00:00:00Z"), validatedAt: at("2026-10-07T00:00:00Z") }));
        await p.cashbacks.insert(cashback("c3", "u2", "o1", { status: "validated", amountCents: 300, createdAt: at("2026-10-08T00:00:00Z"), validatedAt: at("2026-10-08T00:00:00Z") }));
      });

      it("list by member and status newest first, with the offer", async () => {
        const all = await p.cashbacks.list({ userId: "u1", page: 1, pageSize: 10 });
        expect(all.items.map((c) => c.id)).toEqual(["c2", "c1"]);
        expect(all.items[0]?.offer.title).toBe("Charlie");
        expect((await p.cashbacks.list({ userId: "u1", status: "pending", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["c1"]);
        expect((await p.cashbacks.list({ status: "validated", page: 1, pageSize: 10 })).total).toBe(2);
      });

      it("update, count and sum by status", async () => {
        const c = (await p.cashbacks.findById("c1"))!;
        await p.cashbacks.update({ ...c, status: "refused", decidedBy: "manager" });
        expect((await p.cashbacks.findById("c1"))?.status).toBe("refused");
        expect(await p.cashbacks.countByStatus("validated")).toBe(2);
        expect(await p.cashbacks.sumByStatus("validated")).toBe(1000);
        expect(await p.cashbacks.sumByStatus("cancelled")).toBe(0);
      });
    });

    describe("claims", () => {
      beforeAll(async () => {
        await p.claims.insert(claim("k1", "u1", "o1", { filedAt: at("2026-10-10T00:00:00Z"), orderRef: "ORD-AAA" }));
        await p.claims.insert(claim("k2", "u2", "o1", { filedAt: at("2026-10-11T00:00:00Z"), status: "acknowledged", assigneeId: "staff" }));
        await p.claims.insert(claim("k3", "u1", "o3", { filedAt: at("2026-10-12T00:00:00Z"), status: "declined" }));
      });

      it("list newest first with the offer and the member, filtered by member, status, assignee and text", async () => {
        const all = await p.claims.list({ page: 1, pageSize: 10 });
        expect(all.items.map((c) => c.id)).toEqual(["k3", "k2", "k1"]);
        expect(all.items[1]?.member.email).toBe("Second@Example.com");
        expect(all.items[1]?.offer.merchant.id).toBe("m1");
        expect((await p.claims.list({ userId: "u1", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["k3", "k1"]);
        expect((await p.claims.list({ status: "acknowledged", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["k2"]);
        expect((await p.claims.list({ assigneeId: "staff", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["k2"]);
        expect((await p.claims.list({ q: "aaa", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["k1"]);
        expect((await p.claims.list({ q: "second@", page: 1, pageSize: 10 })).items.map((c) => c.id)).toEqual(["k2"]);
      });

      it("count the open claims and update one", async () => {
        expect(await p.claims.countOpen()).toBe(2);
        const k = (await p.claims.findById("k1"))!;
        await p.claims.update({ ...k, status: "declined", declineReason: "order_returned" });
        expect((await p.claims.findById("k1"))?.declineReason).toBe("order_returned");
        expect(await p.claims.countOpen()).toBe(1);
      });
    });

    describe("the ledger", () => {
      beforeAll(async () => {
        await p.ledger.insert([
          entry("l1", "u1", "pending", 500, at("2026-10-06T00:00:00Z")),
          entry("l2", "u1", "pending", -500, at("2026-10-07T00:00:00Z")),
          entry("l3", "u1", "available", 500, at("2026-10-07T00:00:00Z")),
          entry("l4", "u1", "available", 700, at("2026-10-08T00:00:00Z")),
          entry("l5", "u2", "available", 300, at("2026-10-08T00:00:00Z")),
        ]);
      });

      it("sums a member's buckets, with zero for an empty one", async () => {
        expect(await p.ledger.balances("u1")).toEqual({ pending: 0, available: 1200, reserved: 0, paid: 0 });
        expect(await p.ledger.balances("u2")).toEqual({ pending: 0, available: 300, reserved: 0, paid: 0 });
        expect(await p.ledger.balances("nobody")).toEqual({ pending: 0, available: 0, reserved: 0, paid: 0 });
      });

      it("lists a member's entries newest first and by reference", async () => {
        const page = await p.ledger.listByUser("u1", { page: 1, pageSize: 3 });
        expect(page.items.map((e) => e.id)).toEqual(["l4", "l3", "l2"]);
        expect(page.total).toBe(4);
        expect((await p.ledger.listByRef("cashback", "cb_x")).length).toBe(5);
        expect(await p.ledger.sumByKind("u1", "cashback_pending")).toBe(1700);
        expect(await p.ledger.sumByKind("u1", "referral_bonus")).toBe(0);
      });
    });

    describe("payouts", () => {
      beforeAll(async () => {
        await p.payouts.insert(payout("p1", "u1", { requestedAt: at("2026-10-09T00:00:00Z") }));
        await p.payouts.insert(payout("p2", "u2", { requestedAt: at("2026-10-10T00:00:00Z"), status: "sent" }));
      });

      it("lists newest first with the member, filtered by member and status", async () => {
        const all = await p.payouts.list({ page: 1, pageSize: 10 });
        expect(all.items.map((x) => x.id)).toEqual(["p2", "p1"]);
        expect(all.items[0]?.member.displayName).toBe("U2");
        expect((await p.payouts.list({ userId: "u1", page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual(["p1"]);
        expect((await p.payouts.list({ status: "sent", page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual(["p2"]);
      });

      it("updates and counts by status", async () => {
        const x = (await p.payouts.findById("p1"))!;
        await p.payouts.update({ ...x, status: "checking", checkedAt: T0 });
        expect((await p.payouts.findById("p1"))?.status).toBe("checking");
        expect(await p.payouts.countByStatus("checking")).toBe(1);
      });
    });

    describe("referrals", () => {
      it("finds a referral by referee and lists a referrer's with the referee's name", async () => {
        const r: Referral = { id: "r1", referrerId: "u1", refereeId: "u2", code: "u1", status: "pending", createdAt: T0, expiresAt: null, validatedAt: null, bonusUntil: null };
        await p.referrals.insert(r);
        expect((await p.referrals.findByReferee("u2"))?.id).toBe("r1");
        expect(await p.referrals.findByReferee("u1")).toBeNull();
        const list = await p.referrals.listByReferrer("u1");
        expect(list.map((x) => x.referee.displayName)).toEqual(["U2"]);
        expect(await p.referrals.countByReferrer("u1")).toBe(1);
        await p.referrals.update({ ...r, status: "validated" });
        expect((await p.referrals.findByReferee("u2"))?.status).toBe("validated");
      });
    });

    describe("the audit log", () => {
      it("lists newest first, filtered by entity and actor", async () => {
        const e = (id: string, entityType: string, entityId: string, actorId: string | null, iso: string): AuditEntry => ({ id, actorId, action: `${entityType}.x`, entityType, entityId, before: { s: 1 }, after: { s: 2 }, reason: null, at: at(iso) });
        await p.audit.insert(e("au1", "claim", "k1", "staff", "2026-10-10T00:00:00Z"));
        await p.audit.insert(e("au2", "payout", "p1", null, "2026-10-11T00:00:00Z"));
        await p.audit.insert(e("au3", "claim", "k2", "staff", "2026-10-12T00:00:00Z"));
        expect((await p.audit.list({ page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual(["au3", "au2", "au1"]);
        expect((await p.audit.list({ entityType: "claim", page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual(["au3", "au1"]);
        expect((await p.audit.list({ entityType: "claim", entityId: "k1", page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual(["au1"]);
        expect((await p.audit.list({ actorId: "staff", page: 1, pageSize: 10 })).total).toBe(2);
        expect((await p.audit.list({ page: 1, pageSize: 10 })).items[0]?.after).toEqual({ s: 2 });
      });
    });

    describe("reports", () => {
      it("sums the cashback validated in a window", async () => {
        expect(await p.reports.validatedCentsBetween(at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toBe(1000);
        expect(await p.reports.validatedCentsBetween(at("2026-10-08T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toBe(300);
        expect(await p.reports.validatedCentsBetween(at("2026-11-01T00:00:00Z"), at("2026-11-30T00:00:00Z"))).toBe(0);
      });

      it("counts the transactions by match status", async () => {
        expect(await p.transactions.countByMatch("unmatched")).toBe(0);
        expect(await p.transactions.findById("nope")).toBeNull();
      });
    });

    describe("the unit of work", () => {
      it("keeps the writes when the work succeeds", async () => {
        await uow.run(async (tx) => {
          await tx.users.insert(user("u3"));
        });
        expect((await p.users.findById("u3"))?.id).toBe("u3");
      });

      it("drops every write when the work throws", async () => {
        await expect(
          uow.run(async (tx) => {
            await tx.users.insert(user("u4"));
            await tx.merchants.insert(merchant("m9"));
            throw new Error("boom");
          }),
        ).rejects.toThrow("boom");
        expect(await p.users.findById("u4")).toBeNull();
        expect(await p.merchants.findById("m9")).toBeNull();
      });
    });
  });
}
