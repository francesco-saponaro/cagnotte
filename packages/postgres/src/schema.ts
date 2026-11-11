import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/*
 * The thirteen tables of Cagnotte, plus the audit log. Money is integer cents, rates are integer
 * basis points, times are timestamptz, ids are prefixed text so a log line says what it names
 * (usr_, ofr_, act_, cb_ ...). Every state column is a PostgreSQL enum and every rule that can be
 * a constraint is one, so the database refuses what the use cases would refuse.
 */

export const userRole = pgEnum("user_role", ["member", "agent", "manager"]);
export const offerKind = pgEnum("offer_kind", ["online", "voucher"]);
export const rateKind = pgEnum("rate_kind", ["percent", "fixed"]);
export const offerStatus = pgEnum("offer_status", ["draft", "live", "paused", "ended"]);
export const network = pgEnum("network", ["linkpool", "affinet"]);
export const networkStatus = pgEnum("network_status", ["pending", "approved", "declined"]);
export const matchStatus = pgEnum("match_status", ["unmatched", "matched", "ignored"]);
export const cashbackStatus = pgEnum("cashback_status", ["pending", "validated", "refused", "cancelled"]);
export const decidedBy = pgEnum("decided_by", ["network", "manager", "claim"]);
export const claimStatus = pgEnum("claim_status", ["filed", "acknowledged", "raised", "credited", "declined"]);
export const payoutMethod = pgEnum("payout_method", ["transfer", "gift_card", "donation"]);
export const payoutStatus = pgEnum("payout_status", ["requested", "checking", "sent", "failed"]);
export const referralStatus = pgEnum("referral_status", ["pending", "validated", "expired"]);
export const batchStatus = pgEnum("batch_status", ["received", "processed", "failed"]);
export const ledgerBucket = pgEnum("ledger_bucket", ["pending", "available", "reserved", "paid"]);
export const ledgerKind = pgEnum("ledger_kind", [
  "cashback_pending",
  "cashback_validated",
  "cashback_refused",
  "cashback_adjusted",
  "cashback_cancelled",
  "manual_credit",
  "referral_bonus",
  "payout_reserved",
  "payout_sent",
  "payout_failed",
]);

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull(),
    referralCode: text("referral_code").notNull(),
    referredBy: text("referred_by"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    unique("users_email_unique").on(t.email),
    unique("users_referral_code_unique").on(t.referralCode),
    check("users_referral_code_lower", sql`${t.referralCode} = lower(${t.referralCode})`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** The SHA-256 of the token the client holds; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const merchants = pgTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    country: text("country").notNull(),
    /** How long after an activation the network still attributes an order to it. */
    attributionDays: integer("attribution_days").notNull().default(30),
    network: network("network").notNull(),
    /** The merchant's id in the network's exports; how a transaction row finds its merchant. */
    advertiserRef: text("advertiser_ref").notNull(),
  },
  (t) => [
    unique("merchants_slug_unique").on(t.slug),
    unique("merchants_network_advertiser_unique").on(t.network, t.advertiserRef),
    check("merchants_attribution_days_positive", sql`${t.attributionDays} > 0`),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    kind: offerKind("kind").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    rateKind: rateKind("rate_kind").notNull(),
    /** The base rate for a percent offer; 0 for a fixed one. */
    rateBps: integer("rate_bps").notNull().default(0),
    /** The amount for a fixed offer; 0 for a percent one. */
    fixedCents: integer("fixed_cents").notNull().default(0),
    minSpendCents: integer("min_spend_cents").notNull().default(0),
    newCustomersOnly: boolean("new_customers_only").notNull().default(false),
    capCents: integer("cap_cents"),
    /** The merchant's validation window: how long a cashback stays pending. */
    validationDays: integer("validation_days").notNull(),
    status: offerStatus("status").notNull().default("draft"),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("offers_merchant_idx").on(t.merchantId),
    index("offers_status_idx").on(t.status),
    check("offers_rate_bps_range", sql`${t.rateBps} between 0 and 10000`),
    check("offers_fixed_cents_nonneg", sql`${t.fixedCents} >= 0`),
    check("offers_min_spend_nonneg", sql`${t.minSpendCents} >= 0`),
    check("offers_cap_positive", sql`${t.capCents} is null or ${t.capCents} > 0`),
    check("offers_validation_days_positive", sql`${t.validationDays} > 0`),
    check("offers_rate_matches_kind", sql`(${t.rateKind} = 'percent' and ${t.fixedCents} = 0) or (${t.rateKind} = 'fixed' and ${t.rateBps} = 0)`),
  ],
);

export const offerBoosts = pgTable(
  "offer_boosts",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    rateBps: integer("rate_bps").notNull(),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("offer_boosts_offer_idx").on(t.offerId),
    check("offer_boosts_rate_bps_range", sql`${t.rateBps} between 0 and 10000`),
    check("offer_boosts_window", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const activations = pgTable(
  "activations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id),
    /** The id sent to the merchant in the tracking link; the network reports it back. */
    subId: text("sub_id").notNull(),
    /** The rate in force when the member tapped Activate; what the cashback is computed from. */
    rateBps: integer("rate_bps").notNull(),
    boosted: boolean("boosted").notNull().default(false),
    activatedAt: at("activated_at").notNull(),
    trackingUrl: text("tracking_url").notNull(),
  },
  (t) => [
    unique("activations_sub_id_unique").on(t.subId),
    index("activations_user_idx").on(t.userId, t.activatedAt),
    index("activations_offer_idx").on(t.offerId, t.activatedAt),
    check("activations_rate_bps_range", sql`${t.rateBps} between 0 and 10000`),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    network: network("network").notNull(),
    filename: text("filename").notNull(),
    importedBy: text("imported_by")
      .notNull()
      .references(() => users.id),
    status: batchStatus("status").notNull().default("received"),
    rowCount: integer("row_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    unmatchedCount: integer("unmatched_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    /** `[{line, message}]` for the rows that could not be read. */
    errors: jsonb("errors").$type<{ line: number; message: string }[]>().notNull().default([]),
    createdAt: at("created_at").notNull(),
    processedAt: at("processed_at"),
  },
  (t) => [index("import_batches_created_idx").on(t.createdAt)],
);

export const networkTransactions = pgTable(
  "network_transactions",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id),
    network: network("network").notNull(),
    /** The network's own id for the transaction; the key for deduplication across files. */
    networkRef: text("network_ref").notNull(),
    subId: text("sub_id"),
    orderRef: text("order_ref").notNull(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    orderedAt: at("ordered_at").notNull(),
    orderCents: integer("order_cents").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    networkStatus: networkStatus("network_status").notNull(),
    reportedAt: at("reported_at").notNull(),
    matchStatus: matchStatus("match_status").notNull().default("unmatched"),
    activationId: text("activation_id").references(() => activations.id),
    ignoreReason: text("ignore_reason"),
  },
  (t) => [
    unique("network_transactions_ref_unique").on(t.network, t.networkRef),
    index("network_transactions_match_idx").on(t.matchStatus, t.reportedAt),
    index("network_transactions_merchant_idx").on(t.merchantId, t.orderedAt),
    index("network_transactions_order_ref_idx").on(t.orderRef),
    check("network_transactions_order_nonneg", sql`${t.orderCents} >= 0`),
    check("network_transactions_commission_nonneg", sql`${t.commissionCents} >= 0`),
  ],
);

export const cashbacks = pgTable(
  "cashbacks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id),
    /** Null only for a cashback credited from a claim without a matching activation. */
    activationId: text("activation_id").references(() => activations.id),
    networkTransactionId: text("network_transaction_id").references(() => networkTransactions.id),
    orderCents: integer("order_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** True when the amount was cut to the network's commission by the margin rule. */
    marginClamped: boolean("margin_clamped").notNull().default(false),
    status: cashbackStatus("status").notNull().default("pending"),
    decidedBy: decidedBy("decided_by"),
    decisionReason: text("decision_reason"),
    expectedValidationAt: at("expected_validation_at").notNull(),
    validatedAt: at("validated_at"),
    decidedAt: at("decided_at"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    unique("cashbacks_activation_unique").on(t.activationId),
    unique("cashbacks_network_transaction_unique").on(t.networkTransactionId),
    index("cashbacks_user_idx").on(t.userId, t.status, t.createdAt),
    index("cashbacks_status_idx").on(t.status, t.expectedValidationAt),
    check("cashbacks_amount_nonneg", sql`${t.amountCents} >= 0`),
    check("cashbacks_order_nonneg", sql`${t.orderCents} >= 0`),
    check("cashbacks_rate_bps_range", sql`${t.rateBps} between 0 and 10000`),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id),
    orderRef: text("order_ref").notNull(),
    orderedAt: at("ordered_at").notNull(),
    orderCents: integer("order_cents").notNull(),
    /** The confirmation email or invoice, pasted as text. Never a real one in the seed. */
    proofText: text("proof_text").notNull(),
    status: claimStatus("status").notNull().default("filed"),
    assigneeId: text("assignee_id").references(() => users.id),
    networkTransactionId: text("network_transaction_id").references(() => networkTransactions.id),
    cashbackId: text("cashback_id").references(() => cashbacks.id),
    declineReason: text("decline_reason"),
    filedAt: at("filed_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("claims_user_idx").on(t.userId, t.filedAt),
    index("claims_status_idx").on(t.status, t.filedAt),
    index("claims_assignee_idx").on(t.assigneeId),
    check("claims_order_nonneg", sql`${t.orderCents} >= 0`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: ledgerKind("kind").notNull(),
    bucket: ledgerBucket("bucket").notNull(),
    /** Signed: a credit is positive, a reversal or a payout negative. A user's balance in a bucket is the sum. */
    amountCents: integer("amount_cents").notNull(),
    /** What the entry is about: cashback, payout, claim or referral, with its id. */
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    index("ledger_entries_user_idx").on(t.userId, t.bucket, t.createdAt),
    index("ledger_entries_ref_idx").on(t.refType, t.refId),
    check("ledger_entries_amount_nonzero", sql`${t.amountCents} <> 0`),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    method: payoutMethod("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** A masked IBAN, a gift-card brand or a charity name. Never a real account. */
    destination: text("destination").notNull(),
    status: payoutStatus("status").notNull().default("requested"),
    requestedAt: at("requested_at").notNull(),
    checkedAt: at("checked_at"),
    sentAt: at("sent_at"),
    failedReason: text("failed_reason"),
  },
  (t) => [
    index("payouts_user_idx").on(t.userId, t.requestedAt),
    index("payouts_status_idx").on(t.status, t.requestedAt),
    check("payouts_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: text("id").primaryKey(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => users.id),
    refereeId: text("referee_id")
      .notNull()
      .references(() => users.id),
    code: text("code").notNull(),
    status: referralStatus("status").notNull().default("pending"),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at"),
    validatedAt: at("validated_at"),
    /** Until when the referrer earns 10 % of the referee's cashback. */
    bonusUntil: at("bonus_until"),
  },
  (t) => [unique("referrals_referee_unique").on(t.refereeId), index("referrals_referrer_idx").on(t.referrerId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    at: at("at").notNull(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId, t.at), index("audit_log_actor_idx").on(t.actorId, t.at)],
);
