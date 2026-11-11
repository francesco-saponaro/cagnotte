CREATE TYPE "public"."batch_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cashback_status" AS ENUM('pending', 'validated', 'refused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('filed', 'acknowledged', 'raised', 'credited', 'declined');--> statement-breakpoint
CREATE TYPE "public"."decided_by" AS ENUM('network', 'manager', 'claim');--> statement-breakpoint
CREATE TYPE "public"."ledger_bucket" AS ENUM('pending', 'available', 'reserved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('cashback_pending', 'cashback_validated', 'cashback_refused', 'cashback_adjusted', 'cashback_cancelled', 'manual_credit', 'referral_bonus', 'payout_reserved', 'payout_sent', 'payout_failed');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('unmatched', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."network" AS ENUM('linkpool', 'affinet');--> statement-breakpoint
CREATE TYPE "public"."network_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."offer_kind" AS ENUM('online', 'voucher');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'live', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('transfer', 'gift_card', 'donation');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('requested', 'checking', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rate_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'validated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'agent', 'manager');--> statement-breakpoint
CREATE TABLE "activations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"sub_id" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"boosted" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"tracking_url" text NOT NULL,
	CONSTRAINT "activations_sub_id_unique" UNIQUE("sub_id"),
	CONSTRAINT "activations_rate_bps_range" CHECK ("activations"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"activation_id" text,
	"network_transaction_id" text,
	"order_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"margin_clamped" boolean DEFAULT false NOT NULL,
	"status" "cashback_status" DEFAULT 'pending' NOT NULL,
	"decided_by" "decided_by",
	"decision_reason" text,
	"expected_validation_at" timestamp with time zone NOT NULL,
	"validated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cashbacks_activation_unique" UNIQUE("activation_id"),
	CONSTRAINT "cashbacks_network_transaction_unique" UNIQUE("network_transaction_id"),
	CONSTRAINT "cashbacks_amount_nonneg" CHECK ("cashbacks"."amount_cents" >= 0),
	CONSTRAINT "cashbacks_order_nonneg" CHECK ("cashbacks"."order_cents" >= 0),
	CONSTRAINT "cashbacks_rate_bps_range" CHECK ("cashbacks"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"order_ref" text NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"order_cents" integer NOT NULL,
	"proof_text" text NOT NULL,
	"status" "claim_status" DEFAULT 'filed' NOT NULL,
	"assignee_id" text,
	"network_transaction_id" text,
	"cashback_id" text,
	"decline_reason" text,
	"filed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claims_order_nonneg" CHECK ("claims"."order_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"filename" text NOT NULL,
	"imported_by" text NOT NULL,
	"status" "batch_status" DEFAULT 'received' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"bucket" "ledger_bucket" NOT NULL,
	"amount_cents" integer NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("ledger_entries"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"country" text NOT NULL,
	"attribution_days" integer DEFAULT 30 NOT NULL,
	"network" "network" NOT NULL,
	"advertiser_ref" text NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "merchants_network_advertiser_unique" UNIQUE("network","advertiser_ref"),
	CONSTRAINT "merchants_attribution_days_positive" CHECK ("merchants"."attribution_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "network_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"network" "network" NOT NULL,
	"network_ref" text NOT NULL,
	"sub_id" text,
	"order_ref" text NOT NULL,
	"merchant_id" text NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"order_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"network_status" "network_status" NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL,
	"activation_id" text,
	"ignore_reason" text,
	CONSTRAINT "network_transactions_ref_unique" UNIQUE("network","network_ref"),
	CONSTRAINT "network_transactions_order_nonneg" CHECK ("network_transactions"."order_cents" >= 0),
	CONSTRAINT "network_transactions_commission_nonneg" CHECK ("network_transactions"."commission_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offer_boosts" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "offer_boosts_rate_bps_range" CHECK ("offer_boosts"."rate_bps" between 0 and 10000),
	CONSTRAINT "offer_boosts_window" CHECK ("offer_boosts"."ends_at" > "offer_boosts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rate_kind" "rate_kind" NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"fixed_cents" integer DEFAULT 0 NOT NULL,
	"min_spend_cents" integer DEFAULT 0 NOT NULL,
	"new_customers_only" boolean DEFAULT false NOT NULL,
	"cap_cents" integer,
	"validation_days" integer NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_rate_bps_range" CHECK ("offers"."rate_bps" between 0 and 10000),
	CONSTRAINT "offers_fixed_cents_nonneg" CHECK ("offers"."fixed_cents" >= 0),
	CONSTRAINT "offers_min_spend_nonneg" CHECK ("offers"."min_spend_cents" >= 0),
	CONSTRAINT "offers_cap_positive" CHECK ("offers"."cap_cents" is null or "offers"."cap_cents" > 0),
	CONSTRAINT "offers_validation_days_positive" CHECK ("offers"."validation_days" > 0),
	CONSTRAINT "offers_rate_matches_kind" CHECK (("offers"."rate_kind" = 'percent' and "offers"."fixed_cents" = 0) or ("offers"."rate_kind" = 'fixed' and "offers"."rate_bps" = 0))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" "payout_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"destination" text NOT NULL,
	"status" "payout_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_reason" text,
	CONSTRAINT "payouts_amount_positive" CHECK ("payouts"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"referee_id" text NOT NULL,
	"code" text NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"bonus_until" timestamp with time zone,
	CONSTRAINT "referrals_referee_unique" UNIQUE("referee_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_referral_code_lower" CHECK ("users"."referral_code" = lower("users"."referral_code"))
);
--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbacks" ADD CONSTRAINT "cashbacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbacks" ADD CONSTRAINT "cashbacks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbacks" ADD CONSTRAINT "cashbacks_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbacks" ADD CONSTRAINT "cashbacks_network_transaction_id_network_transactions_id_fk" FOREIGN KEY ("network_transaction_id") REFERENCES "public"."network_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_network_transaction_id_network_transactions_id_fk" FOREIGN KEY ("network_transaction_id") REFERENCES "public"."network_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_cashback_id_cashbacks_id_fk" FOREIGN KEY ("cashback_id") REFERENCES "public"."cashbacks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_transactions" ADD CONSTRAINT "network_transactions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_transactions" ADD CONSTRAINT "network_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_transactions" ADD CONSTRAINT "network_transactions_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_boosts" ADD CONSTRAINT "offer_boosts_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_boosts" ADD CONSTRAINT "offer_boosts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activations_user_idx" ON "activations" USING btree ("user_id","activated_at");--> statement-breakpoint
CREATE INDEX "activations_offer_idx" ON "activations" USING btree ("offer_id","activated_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "cashbacks_user_idx" ON "cashbacks" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "cashbacks_status_idx" ON "cashbacks" USING btree ("status","expected_validation_at");--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" USING btree ("user_id","filed_at");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status","filed_at");--> statement-breakpoint
CREATE INDEX "claims_assignee_idx" ON "claims" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_user_idx" ON "ledger_entries" USING btree ("user_id","bucket","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_ref_idx" ON "ledger_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "network_transactions_match_idx" ON "network_transactions" USING btree ("match_status","reported_at");--> statement-breakpoint
CREATE INDEX "network_transactions_merchant_idx" ON "network_transactions" USING btree ("merchant_id","ordered_at");--> statement-breakpoint
CREATE INDEX "network_transactions_order_ref_idx" ON "network_transactions" USING btree ("order_ref");--> statement-breakpoint
CREATE INDEX "offer_boosts_offer_idx" ON "offer_boosts" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offers_merchant_idx" ON "offers" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "payouts" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");