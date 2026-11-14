import { CLAIM_DECLINE_REASONS, MAX_PAGE_SIZE, passwordProblems } from "@cagnotte/domain";
import { z } from "zod";

/*
 * What a request may look like, as zod. The API parses every body and query with these; the app's
 * forms validate with the same objects, so a field the server would refuse is refused on the phone
 * first, with the same words. The business rules (minimums, windows, transitions) are not here:
 * they live in the use cases and come back as 422 or 409.
 */

const trimmed = z.string().trim();
const required = trimmed.min(1, "required");
const cents = z.number().int("whole cents").min(0);
const bps = z.number().int().min(0).max(10000);
const instant = z.coerce.date();
const flag = z
  .union([z.boolean(), z.enum(["1", "0", "true", "false"])])
  .transform((v) => v === true || v === "1" || v === "true")
  .optional();

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export const signUpBody = z.object({
  email: trimmed.toLowerCase().email("not a valid email"),
  password: z.string().superRefine((password, ctx) => {
    const problems = passwordProblems(password);
    if (problems.length > 0) ctx.addIssue({ code: "custom", message: `password needs ${problems.join(", ")}` });
  }),
  displayName: required.max(80),
  referralCode: trimmed.toLowerCase().max(32).optional(),
});

export const signInBody = z.object({ email: trimmed.toLowerCase().email("not a valid email"), password: z.string().min(1, "required") });

export const offerKind = z.enum(["online", "voucher"]);
export const offerSort = z.enum(["rate", "newest", "name"]);

export const listOffersQuery = pageQuery.extend({
  q: trimmed.max(80).optional(),
  merchant: trimmed.optional(),
  kind: offerKind.optional(),
  category: trimmed.max(40).optional(),
  sort: offerSort.default("rate"),
  all: flag,
});

export const cashbackStatus = z.enum(["pending", "validated", "refused", "cancelled"]);
export const listCashbacksQuery = pageQuery.extend({ status: cashbackStatus.optional() });

export const payoutMethod = z.enum(["transfer", "gift_card", "donation"]);
export const requestPayoutBody = z.object({ method: payoutMethod, amountCents: cents.min(1), destination: required.max(120) });

export const payoutStatus = z.enum(["requested", "checking", "sent", "failed"]);
export const listPayoutsQuery = pageQuery.extend({ status: payoutStatus.optional() });
export const failPayoutBody = z.object({ reason: required.max(200) });

export const fileClaimBody = z.object({
  offerId: required,
  orderRef: required.max(80),
  orderedAt: instant,
  orderCents: cents,
  proofText: required.max(10000),
});

export const claimStatus = z.enum(["filed", "acknowledged", "raised", "credited", "declined"]);
export const listClaimsQuery = pageQuery.extend({ status: claimStatus.optional(), assignee: trimmed.optional(), q: trimmed.max(80).optional() });
export const assignClaimBody = z.object({ assigneeId: required });
export const raiseClaimBody = z.object({ networkTransactionId: required.optional() });
export const declineClaimBody = z.object({ reason: z.enum(CLAIM_DECLINE_REASONS) });

export const decisionBody = z.object({ reason: required.max(200) });

export const network = z.enum(["linkpool", "affinet"]);
export const createMerchantBody = z.object({
  slug: required.max(60),
  name: required.max(80),
  category: required.max(40),
  country: required.length(2),
  attributionDays: z.number().int().min(1).max(365),
  network,
  advertiserRef: required.max(40),
});

export const rateKind = z.enum(["percent", "fixed"]);
export const createOfferBody = z.object({
  merchantId: required,
  kind: offerKind,
  title: required.max(120),
  description: trimmed.max(1000).default(""),
  rateKind,
  rateBps: bps.default(0),
  fixedCents: cents.default(0),
  minSpendCents: cents.default(0),
  newCustomersOnly: z.boolean().default(false),
  capCents: cents.min(1).nullable().default(null),
  validationDays: z.number().int().min(1).max(365),
  startsAt: instant,
  endsAt: instant.nullable().default(null),
});
export const updateOfferBody = createOfferBody.omit({ merchantId: true }).partial();

export const addBoostBody = z
  .object({ rateBps: bps, startsAt: instant, endsAt: instant })
  .refine((b) => b.endsAt.getTime() > b.startsAt.getTime(), { message: "a boost must end after it starts", path: ["endsAt"] });

export const importBody = z.object({
  network,
  filename: required.max(120),
  /** The export file as text; one network's CSV or the other's JSON. */
  content: z.string().min(1, "the file is empty").max(1_000_000, "the file is too large; split it"),
});
export const matchStatus = z.enum(["unmatched", "matched", "ignored"]);
export const listTransactionsQuery = pageQuery.extend({ match: matchStatus.optional(), network: network.optional(), merchant: trimmed.optional(), batch: trimmed.optional() });
export const matchTransactionBody = z.object({ activationId: required });
export const ignoreTransactionBody = z.object({ reason: required.max(200) });

export const auditQuery = pageQuery.extend({ entityType: trimmed.optional(), entityId: trimmed.optional(), actorId: trimmed.optional() });
export const marginQuery = z.object({ from: instant.optional(), to: instant.optional() });

export type SignUpBody = z.infer<typeof signUpBody>;
export type SignInBody = z.infer<typeof signInBody>;
export type ListOffersQuery = z.infer<typeof listOffersQuery>;
export type RequestPayoutBody = z.infer<typeof requestPayoutBody>;
export type FileClaimBody = z.infer<typeof fileClaimBody>;
export type CreateMerchantBody = z.infer<typeof createMerchantBody>;
export type CreateOfferBody = z.infer<typeof createOfferBody>;
export type UpdateOfferBody = z.infer<typeof updateOfferBody>;
export type AddBoostBody = z.infer<typeof addBoostBody>;
export type ImportBody = z.infer<typeof importBody>;
