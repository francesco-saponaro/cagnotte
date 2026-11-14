import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Referral } from "../src/index.js";
import { AGENT, MANAGER, activation, daysAgo, offer, unwrap, user, world } from "./harness.js";

/*
 * The ledger invariants over random histories. fast-check writes a sequence of the things that
 * happen to a cashback app (network files, corrections, manual decisions, payouts, claims, matches
 * by hand), runs it on the in-memory world, and after every single step checks what must always be
 * true of the book. Then the reconciliation report has to agree. A failing run is shrunk to the
 * shortest history that breaks a rule, which is how a booking bug would be found.
 */

const HEADER = "transaction_id,advertiser_id,click_ref,order_ref,transaction_date,sale_amount,commission_amount,status,last_updated";
const MEMBERS = ["usr_member", "usr_other", "usr_third", "usr_fourth"] as const;
const OFFERS = ["ofr_live", "ofr_min", "ofr_cap", "ofr_new", "ofr_fixed_a"] as const;
const CLICKS = 10;
const sub = (id: string) => id.padEnd(16, "0");

type Command =
  | { kind: "import"; rows: { ref: number; click: number | null; status: "pending" | "approved" | "declined"; amount: number; commission: number }[] }
  | { kind: "decide"; cashback: number; to: "validate" | "refuse" | "cancel" }
  | { kind: "payout"; member: number; amount: number }
  | { kind: "payoutStep"; payout: number; step: "check" | "send" | "fail" }
  | { kind: "claim"; click: number; amount: number }
  | { kind: "match"; transaction: number; click: number };

const command: fc.Arbitrary<Command> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("import" as const), rows: fc.array(fc.record({ ref: fc.integer({ min: 0, max: 12 }), click: fc.option(fc.integer({ min: 0, max: CLICKS - 1 }), { nil: null }), status: fc.constantFrom("pending" as const, "approved" as const, "declined" as const), amount: fc.integer({ min: 0, max: 40000 }), commission: fc.integer({ min: 0, max: 3000 }) }), { minLength: 1, maxLength: 4 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("decide" as const), cashback: fc.nat(20), to: fc.constantFrom("validate" as const, "refuse" as const, "cancel" as const) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("payout" as const), member: fc.integer({ min: 0, max: MEMBERS.length - 1 }), amount: fc.integer({ min: 100, max: 6000 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("payoutStep" as const), payout: fc.nat(10), step: fc.constantFrom("check" as const, "send" as const, "fail" as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("claim" as const), click: fc.integer({ min: 0, max: CLICKS - 1 }), amount: fc.integer({ min: 500, max: 30000 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("match" as const), transaction: fc.nat(20), click: fc.integer({ min: 0, max: CLICKS - 1 }) }) },
);

function build() {
  const clicks = Array.from({ length: CLICKS }, (_, i) => activation(`act_${i}`, MEMBERS[i % MEMBERS.length]!, OFFERS[i % OFFERS.length]!, daysAgo(10 + (i % 5))));
  const referral: Referral = { id: "ref_1", referrerId: "usr_member", refereeId: "usr_other", code: "member", status: "pending", createdAt: daysAgo(30), expiresAt: daysAgo(-60), validatedAt: null, bonusUntil: null };
  return world({
    users: [user("usr_third", "member"), user("usr_fourth", "member")],
    offers: [offer("ofr_min", "mer_a", { minSpendCents: 5000 }), offer("ofr_cap", "mer_a", { capCents: 400, rateBps: 1000 }), offer("ofr_new", "mer_a", { newCustomersOnly: true }), offer("ofr_fixed_a", "mer_a", { rateKind: "fixed", rateBps: 0, fixedCents: 700 })],
    activations: clicks,
    referrals: [referral],
  });
}

const money = (cents: number) => `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}`;

async function run(w: ReturnType<typeof world>, c: Command, step: number): Promise<void> {
  switch (c.kind) {
    case "import": {
      const lines = c.rows.map((r) => [`LP${r.ref}`, "LP-mer_a", r.click === null ? "" : sub(`act_${r.click}`), `ORD-${r.ref}`, daysAgo(8).toISOString(), money(r.amount), money(r.commission), r.status, daysAgo(7).toISOString()].join(","));
      await w.importFile(MANAGER, { network: "linkpool", filename: `file-${step}.csv`, content: [HEADER, ...lines].join("\n") });
      return;
    }
    case "decide": {
      const cb = w.store.cashbacks[c.cashback % Math.max(1, w.store.cashbacks.length)];
      if (!cb) return;
      const fn = { validate: w.validateCashback, refuse: w.refuseCashback, cancel: w.cancelCashback }[c.to];
      await fn(MANAGER, cb.id, { reason: "by hand" });
      return;
    }
    case "payout":
      await w.requestPayout({ id: MEMBERS[c.member]!, role: "member" }, { method: "gift_card", amountCents: c.amount, destination: "Shop" });
      return;
    case "payoutStep": {
      const p = w.store.payouts[c.payout % Math.max(1, w.store.payouts.length)];
      if (!p) return;
      if (c.step === "check") await w.checkPayout(MANAGER, p.id);
      else if (c.step === "send") {
        // The two steps a manager takes to pay: check, then send.
        await w.checkPayout(MANAGER, p.id);
        await w.sendPayout(MANAGER, p.id);
      } else await w.failPayout(MANAGER, p.id, { reason: "returned" });
      return;
    }
    case "claim": {
      const click = w.store.activations[c.click]!;
      const filed = await w.fileClaim({ id: click.userId, role: "member" }, { offerId: click.offerId, orderRef: `ORD-CLAIM-${step}`, orderedAt: daysAgo(8), orderCents: c.amount, proofText: "proof" });
      if (!filed.ok) return;
      await w.acknowledgeClaim(AGENT, filed.value.id);
      await w.raiseClaim(AGENT, filed.value.id, {});
      await w.creditClaim(AGENT, filed.value.id);
      return;
    }
    case "match": {
      const tx = w.store.transactions[c.transaction % Math.max(1, w.store.transactions.length)];
      if (!tx) return;
      await w.matchTransaction(MANAGER, tx.id, { activationId: `act_${c.click}` });
      return;
    }
  }
}

/** What must be true of the book after every step. Throws with the step and the rule otherwise. */
function checkInvariants(w: ReturnType<typeof world>, step: number): void {
  const { ledgerEntries, cashbacks, payouts } = w.store;
  const sum = (entries: typeof ledgerEntries) => entries.reduce((n, e) => n + e.amountCents, 0);
  const fail = (rule: string) => {
    throw new Error(`after step ${step}: ${rule}`);
  };
  const byUserBucket = new Map<string, number>();
  for (const e of ledgerEntries) {
    if (e.amountCents === 0) fail(`entry ${e.id} is zero`);
    byUserBucket.set(`${e.userId}:${e.bucket}`, (byUserBucket.get(`${e.userId}:${e.bucket}`) ?? 0) + e.amountCents);
  }
  for (const [key, value] of byUserBucket) if (value < 0) fail(`${key} is ${value}`);
  for (const cb of cashbacks) {
    const entries = ledgerEntries.filter((e) => e.refType === "cashback" && e.refId === cb.id);
    if (entries.some((e) => e.userId !== cb.userId)) fail(`${cb.id} has an entry for another member`);
    const pending = sum(entries.filter((e) => e.bucket === "pending"));
    const available = sum(entries.filter((e) => e.bucket === "available"));
    const expected = { pending: [cb.amountCents, 0], validated: [0, cb.amountCents], refused: [0, 0], cancelled: [0, 0] }[cb.status];
    if (pending !== expected[0] || available !== expected[1]) fail(`${cb.id} (${cb.status}, ${cb.amountCents}) nets to pending ${pending}, available ${available}`);
    if (cb.amountCents <= 0) fail(`${cb.id} has amount ${cb.amountCents}`);
  }
  for (const p of payouts) {
    const entries = ledgerEntries.filter((e) => e.refType === "payout" && e.refId === p.id);
    const by = (bucket: string) => sum(entries.filter((e) => e.bucket === bucket));
    const expected = { requested: [-p.amountCents, p.amountCents, 0], checking: [-p.amountCents, p.amountCents, 0], sent: [-p.amountCents, 0, p.amountCents], failed: [0, 0, 0] }[p.status];
    if (by("available") !== expected[0] || by("reserved") !== expected[1] || by("paid") !== expected[2]) fail(`${p.id} (${p.status}) nets wrong`);
  }
  const bucket = (b: string) => sum(ledgerEntries.filter((e) => e.bucket === b));
  const pendingCashbacks = sum(cashbacks.filter((c) => c.status === "pending").map((c) => ({ amountCents: c.amountCents })) as typeof ledgerEntries);
  const validatedCashbacks = cashbacks.filter((c) => c.status === "validated").reduce((n, c) => n + c.amountCents, 0);
  const bonuses = sum(ledgerEntries.filter((e) => e.kind === "referral_bonus"));
  if (bucket("pending") !== pendingCashbacks) fail(`pending bucket ${bucket("pending")} vs pending cashbacks ${pendingCashbacks}`);
  if (bucket("available") + bucket("reserved") + bucket("paid") !== validatedCashbacks + bonuses) fail(`available+reserved+paid ${bucket("available") + bucket("reserved") + bucket("paid")} vs validated ${validatedCashbacks} + bonuses ${bonuses}`);
  for (const t of w.store.transactions) {
    const cb = cashbacks.find((c) => c.networkTransactionId === t.id);
    if (cb && t.matchStatus !== "matched") fail(`${t.id} has cashback ${cb.id} but is ${t.matchStatus}`);
    if (t.matchStatus === "matched" && t.activationId === null) fail(`${t.id} is matched to nothing`);
  }
  const perActivation = new Map<string, number>();
  for (const cb of cashbacks) if (cb.activationId) perActivation.set(cb.activationId, (perActivation.get(cb.activationId) ?? 0) + 1);
  for (const [id, n] of perActivation) if (n > 1) fail(`click ${id} has ${n} cashbacks`);
}

describe("the ledger over random histories", () => {
  it("keeps every invariant after every step, and the reconciliation report agrees", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 30 }), async (commands) => {
        const w = build();
        let step = 0;
        for (const c of commands) {
          step++;
          await run(w, c, step);
          checkInvariants(w, step);
        }
        const report = unwrap(await w.getReconciliation(MANAGER));
        expect(report.ok, JSON.stringify(report)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("exercises every path: something gets validated, refused, cancelled, adjusted, paid out and credited from a claim", async () => {
    // A fixed long history, so the property above is known to reach the interesting states and not only the trivial ones.
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 30, maxLength: 60 }), async (commands) => {
        const w = build();
        let step = 0;
        for (const c of commands) await run(w, c, ++step);
        for (const cb of w.store.cashbacks) seen.add(cb.status);
        for (const e of w.store.ledgerEntries) seen.add(e.kind);
        for (const p of w.store.payouts) seen.add(`payout:${p.status}`);
        return true;
      }),
      { numRuns: 120, seed: 20261113 },
    );
    for (const expected of ["pending", "validated", "refused", "cancelled", "cashback_adjusted", "manual_credit", "referral_bonus", "payout_sent", "payout_failed", "payout:sent"]) expect(seen, expected).toContain(expected);
  });
});
