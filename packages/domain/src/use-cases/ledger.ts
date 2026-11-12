import type { LedgerBucket, LedgerEntry, LedgerKind } from "../entities.js";
import type { Clock, IdGenerator } from "../ports.js";

/*
 * The one place ledger entries are written. Every movement is two entries that net to zero
 * across buckets (a transfer) or one entry that changes the total (a credit or a reversal), so a
 * member's buckets always add up to what they have earned minus what has left.
 */

export interface Movement {
  userId: string;
  kind: LedgerKind;
  refType: "cashback" | "payout" | "claim" | "referral";
  refId: string;
  note?: string | null;
  createdBy?: string | null;
}

export function ledgerWriterCreator(ids: IdGenerator, clock: Clock) {
  const entry = (m: Movement, bucket: LedgerBucket, amountCents: number): LedgerEntry => ({
    id: ids.id("led_"),
    userId: m.userId,
    kind: m.kind,
    bucket,
    amountCents,
    refType: m.refType,
    refId: m.refId,
    note: m.note ?? null,
    createdBy: m.createdBy ?? null,
    createdAt: clock.now(),
  });

  return {
    /** `+amount` into a bucket: a pending credit, a manual credit, a bonus. */
    credit: (m: Movement, bucket: LedgerBucket, amountCents: number): LedgerEntry[] => (amountCents === 0 ? [] : [entry(m, bucket, amountCents)]),
    /** `−amount` out of a bucket: a refusal, a cancellation. */
    reverse: (m: Movement, bucket: LedgerBucket, amountCents: number): LedgerEntry[] => (amountCents === 0 ? [] : [entry(m, bucket, -amountCents)]),
    /** The amount leaves one bucket and enters another: validation, reservation, sending, a failed payout. */
    transfer: (m: Movement, from: LedgerBucket, to: LedgerBucket, amountCents: number): LedgerEntry[] => (amountCents === 0 ? [] : [entry(m, from, -amountCents), entry(m, to, amountCents)]),
  };
}
