import type { Actor, LedgerBucket } from "../entities.js";
import type { Balances, Deps } from "../ports.js";
import { ok, type Result } from "../result.js";
import { requireRole } from "./access.js";

/*
 * The proof that the ledger is right: every number recomputed from the entries and compared with
 * the records that explain them. Balances are never stored, so this is not a check of a cache but
 * of the booking rules themselves: if a step ever wrote the wrong entries, one of these lines says
 * where.
 */

export interface ReconciliationCheck {
  name: string;
  expected: number;
  actual: number;
  ok: boolean;
}

export interface ReconciliationReport {
  at: Date;
  /** The whole book by bucket, every member together. */
  buckets: Balances;
  cashbacks: { pendingCents: number; validatedCents: number };
  bonusCents: number;
  checks: ReconciliationCheck[];
  cashbacksOutOfBalance: string[];
  payoutsOutOfBalance: string[];
  negativeBalances: { userId: string; bucket: LedgerBucket; amountCents: number }[];
  ok: boolean;
}

export function reconciliationUseCasesCreator(deps: Deps) {
  const { ports, clock } = deps;

  const getReconciliation = async (actor: Actor): Promise<Result<ReconciliationReport>> => {
    const denied = requireRole<ReconciliationReport>(actor, "manager");
    if (denied) return denied;
    const [buckets, pendingCents, validatedCents, bonusCents, cashbacksOutOfBalance, payoutsOutOfBalance, negativeBalances] = await Promise.all([
      ports.reports.bucketTotals(),
      ports.cashbacks.sumByStatus("pending"),
      ports.cashbacks.sumByStatus("validated"),
      ports.reports.ledgerTotalByKind("referral_bonus"),
      ports.reports.cashbacksOutOfBalance(),
      ports.reports.payoutsOutOfBalance(),
      ports.reports.negativeBalances(),
    ]);
    const check = (name: string, expected: number, actual: number): ReconciliationCheck => ({ name, expected, actual, ok: expected === actual });
    const checks = [
      check("pending bucket = pending cashbacks", pendingCents, buckets.pending),
      check("available + reserved + paid = validated cashbacks + referral bonuses", validatedCents + bonusCents, buckets.available + buckets.reserved + buckets.paid),
    ];
    return ok({
      at: clock.now(),
      buckets,
      cashbacks: { pendingCents, validatedCents },
      bonusCents,
      checks,
      cashbacksOutOfBalance,
      payoutsOutOfBalance,
      negativeBalances,
      ok: checks.every((c) => c.ok) && cashbacksOutOfBalance.length === 0 && payoutsOutOfBalance.length === 0 && negativeBalances.length === 0,
    });
  };

  return { getReconciliation };
}
