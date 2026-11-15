import type {
  Activation,
  CashbackDetail,
  CashbackWithOffer,
  Claim,
  ClaimWithOffer,
  OfferDetail,
  OfferWithMerchant,
  Page,
  Payout,
  PublicUser,
  ReferralsView,
  SignedIn,
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
