import type {
  Activation,
  AuditEntry,
  Cashback,
  CashbackStatus,
  Claim,
  ClaimStatus,
  LedgerBucket,
  LedgerEntry,
  LedgerKind,
  Merchant,
  NetworkTransaction,
  Offer,
  OfferBoost,
  OfferKind,
  OfferStatus,
  Payout,
  PayoutStatus,
  Referral,
  Session,
  User,
  UserRole,
} from "./entities.js";

/*
 * The ports: what the use cases need from the outside world, as interfaces. `packages/postgres`
 * implements them over Drizzle; `inMemoryPortsCreator` implements them over arrays for tests and
 * for the app's component tests. A use case never sees which one it has.
 */

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const MAX_PAGE_SIZE = 50;

/** Clamps a page request to what a list route accepts. */
export function pageQuery(query: Partial<PageQuery> | undefined): PageQuery {
  const page = Math.max(1, Math.floor(query?.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query?.pageSize ?? 20)));
  return { page, pageSize };
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByReferralCode(code: string): Promise<User | null>;
  insert(user: User): Promise<void>;
  countByRole(role: UserRole): Promise<number>;
}

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  /** The session with this id when it has not expired at `now`. */
  findActive(id: string, now: Date): Promise<Session | null>;
  delete(id: string): Promise<void>;
}

export interface MerchantRepository {
  findById(id: string): Promise<Merchant | null>;
  findBySlug(slug: string): Promise<Merchant | null>;
  list(): Promise<Merchant[]>;
  insert(merchant: Merchant): Promise<void>;
}

export type OfferSort = "rate" | "newest" | "name";

export interface OfferFilter extends PageQuery {
  statuses: readonly OfferStatus[];
  q?: string;
  merchantId?: string;
  kind?: OfferKind;
  category?: string;
  sort: OfferSort;
}

export type OfferWithMerchant = Offer & { merchant: Merchant };

export interface OfferRepository {
  findById(id: string): Promise<OfferWithMerchant | null>;
  list(filter: OfferFilter): Promise<Page<OfferWithMerchant>>;
  insert(offer: Offer): Promise<void>;
  update(offer: Offer): Promise<void>;
  countByStatus(status: OfferStatus): Promise<number>;
  boostsOf(offerId: string): Promise<OfferBoost[]>;
  insertBoost(boost: OfferBoost): Promise<void>;
}

export interface ActivationRepository {
  findById(id: string): Promise<Activation | null>;
  insert(activation: Activation): Promise<void>;
  listByUser(userId: string, page: PageQuery): Promise<Page<Activation & { offer: OfferWithMerchant }>>;
  /** The member's latest activation of the offer at or before `at`, the one a claim must point at. */
  latestBefore(userId: string, offerId: string, at: Date): Promise<Activation | null>;
}

export interface CashbackFilter extends PageQuery {
  userId?: string;
  status?: CashbackStatus;
}

export type CashbackWithOffer = Cashback & { offer: OfferWithMerchant };

export interface CashbackRepository {
  findById(id: string): Promise<CashbackWithOffer | null>;
  list(filter: CashbackFilter): Promise<Page<CashbackWithOffer>>;
  insert(cashback: Cashback): Promise<void>;
  update(cashback: Cashback): Promise<void>;
  countByStatus(status: CashbackStatus): Promise<number>;
  sumByStatus(status: CashbackStatus): Promise<number>;
}

export interface ClaimFilter extends PageQuery {
  userId?: string;
  status?: ClaimStatus;
  assigneeId?: string;
  /** Matches the order reference or the member's email. */
  q?: string;
}

export type ClaimWithOffer = Claim & { offer: OfferWithMerchant; member: { id: string; email: string; displayName: string } };

export interface ClaimRepository {
  findById(id: string): Promise<ClaimWithOffer | null>;
  list(filter: ClaimFilter): Promise<Page<ClaimWithOffer>>;
  insert(claim: Claim): Promise<void>;
  update(claim: Claim): Promise<void>;
  countOpen(): Promise<number>;
}

export type Balances = Record<LedgerBucket, number>;

export interface LedgerRepository {
  insert(entries: LedgerEntry[]): Promise<void>;
  balances(userId: string): Promise<Balances>;
  listByUser(userId: string, page: PageQuery): Promise<Page<LedgerEntry>>;
  listByRef(refType: string, refId: string): Promise<LedgerEntry[]>;
  /** The sum of a member's entries of one kind, e.g. every referral bonus they were paid. */
  sumByKind(userId: string, kind: LedgerKind): Promise<number>;
}

export interface PayoutFilter extends PageQuery {
  userId?: string;
  status?: PayoutStatus;
}

export type PayoutWithMember = Payout & { member: { id: string; email: string; displayName: string } };

export interface PayoutRepository {
  findById(id: string): Promise<Payout | null>;
  list(filter: PayoutFilter): Promise<Page<PayoutWithMember>>;
  insert(payout: Payout): Promise<void>;
  update(payout: Payout): Promise<void>;
  countByStatus(status: PayoutStatus): Promise<number>;
}

export interface ReferralRepository {
  findByReferee(refereeId: string): Promise<Referral | null>;
  listByReferrer(referrerId: string): Promise<(Referral & { referee: { displayName: string; createdAt: Date } })[]>;
  countByReferrer(referrerId: string): Promise<number>;
  insert(referral: Referral): Promise<void>;
  update(referral: Referral): Promise<void>;
}

export interface NetworkTransactionRepository {
  findById(id: string): Promise<NetworkTransaction | null>;
  countByMatch(status: NetworkTransaction["matchStatus"]): Promise<number>;
}

export interface AuditFilter extends PageQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
}

export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  list(filter: AuditFilter): Promise<Page<AuditEntry>>;
}

export interface MarginLine {
  merchantId: string;
  merchantName: string;
  transactions: number;
  orderCents: number;
  commissionCents: number;
  cashbackCents: number;
}

export interface ReportRepository {
  /** Per merchant, the orders reported between the two instants: what the networks pay and what the members get. */
  margin(from: Date, to: Date): Promise<MarginLine[]>;
  /** The cashback validated in the window (by `validatedAt`), in cents. */
  validatedCentsBetween(from: Date, to: Date): Promise<number>;
}

export interface Ports {
  users: UserRepository;
  sessions: SessionRepository;
  merchants: MerchantRepository;
  offers: OfferRepository;
  activations: ActivationRepository;
  cashbacks: CashbackRepository;
  claims: ClaimRepository;
  ledger: LedgerRepository;
  payouts: PayoutRepository;
  referrals: ReferralRepository;
  transactions: NetworkTransactionRepository;
  audit: AuditRepository;
  reports: ReportRepository;
}

/** Runs `work` so that either every write in it lands or none does. */
export interface UnitOfWork {
  run<T>(work: (ports: Ports) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** A new id with the prefix, e.g. `act_` + random. */
  id(prefix: string): string;
  /** `length` lower-case alphanumerics, unpredictable. */
  token(length: number): string;
}

/** Everything a use case factory takes. */
export interface Deps {
  ports: Ports;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  sessionHours: number;
}
