import type {
  Activation,
  AuditEntry,
  CashbackDetail,
  CashbackWithOffer,
  Claim,
  ClaimWithOffer,
  ImportBatch,
  MarginReport,
  Merchant,
  NetworkTransaction,
  OfferBoost,
  OfferDetail,
  OfferWithMerchant,
  Overview,
  Page,
  Payout,
  PayoutWithMember,
  Proposal,
  PublicUser,
  ReconciliationReport,
  ReferralsView,
  SignedIn,
  TransactionDetail,
  TransactionWithMerchant,
  Wallet,
} from "@cagnotte/domain";

/*
 * What the API returns, as the app receives it: the domain's shapes with every Date serialised to
 * an ISO string by JSON. The screens parse a date only when they format it.
 */

export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type { Page };
export type UserRow = Serialized<PublicUser>;
export type SignedInRow = Serialized<SignedIn>;
export type OfferRow = Serialized<OfferWithMerchant>;
export type OfferDetailRow = Serialized<OfferDetail>;
export type ActivationRow = Serialized<Activation>;
export type ActivationWithOfferRow = Serialized<Activation & { offer: OfferWithMerchant }>;
export type CashbackRow = Serialized<CashbackWithOffer>;
export type CashbackDetailRow = Serialized<CashbackDetail>;
export type WalletRow = Serialized<Wallet>;
export type PayoutRow = Serialized<Payout>;
export type ClaimRow = Serialized<ClaimWithOffer>;
export type ClaimDetailRow = Serialized<Claim>;
export type ReferralsRow = Serialized<ReferralsView>;

// The back office.
export type MerchantRow = Serialized<Merchant>;
export type BoostRow = Serialized<OfferBoost>;
export type ImportBatchRow = Serialized<ImportBatch>;
export type TransactionRow = Serialized<TransactionWithMerchant>;
export type TransactionDetailRow = Serialized<TransactionDetail>;
export type TransactionPlainRow = Serialized<NetworkTransaction>;
export type ProposalRow = Serialized<Proposal>;
export type PayoutWithMemberRow = Serialized<PayoutWithMember>;
export type OverviewRow = Serialized<Overview>;
export type MarginReportRow = Serialized<MarginReport>;
export type ReconciliationRow = Serialized<ReconciliationReport>;
export type AuditRow = Serialized<AuditEntry>;
