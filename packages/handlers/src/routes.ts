import {
  addBoostBody,
  assignClaimBody,
  auditQuery,
  createMerchantBody,
  createOfferBody,
  declineClaimBody,
  decisionBody,
  failPayoutBody,
  fileClaimBody,
  ignoreTransactionBody,
  importBody,
  listCashbacksQuery,
  listClaimsQuery,
  listOffersQuery,
  listPayoutsQuery,
  listTransactionsQuery,
  marginQuery,
  matchTransactionBody,
  pageQuery,
  raiseClaimBody,
  requestPayoutBody,
  signInBody,
  signUpBody,
  updateOfferBody,
} from "@cagnotte/contracts";
import type { Actor, Result, UseCases, UserRole } from "@cagnotte/domain";

/*
 * Every route of the API as data: method, path, the least role it needs, the status of a success,
 * and a handler that parses with the schema from `packages/contracts`, calls one use case and
 * returns its result. Nothing here knows about HTTP objects, so the server registers this table
 * with Fastify and the browser demo dispatches on it in the page: one list, two front doors.
 */

export type Method = "GET" | "POST" | "PATCH";

export interface HandlerInput {
  /** The `:name` segments of the path, by name. */
  params: Record<string, string>;
  /** The query string, every value still text; the route's schema coerces it. */
  query: Record<string, unknown>;
  body: unknown;
  /** The signed-in user, or null on a public route. */
  actor: Actor | null;
  token: string | null;
}

export interface Route {
  method: Method;
  path: string;
  /** The least role the route needs; null for a public route. */
  role: UserRole | null;
  /** The status of a success: 200, 201 for a creation, 204 for no body. */
  status: 200 | 201 | 204;
  handle: (input: HandlerInput) => Promise<Result<unknown>>;
}

type Signed = (actor: Actor, input: HandlerInput & { actor: Actor; token: string }) => Promise<Result<unknown>>;

/** A route the dispatcher only calls once the role check passed, so the actor is there. */
function on(method: Method, path: string, role: UserRole, handle: Signed, status: Route["status"] = 200): Route {
  return {
    method,
    path,
    role,
    status,
    handle: (input) => {
      if (!input.actor || !input.token) throw new Error(`${method} ${path} was called without an actor`);
      return handle(input.actor, { ...input, actor: input.actor, token: input.token });
    },
  };
}

function open(method: Method, path: string, handle: (input: HandlerInput) => Promise<Result<unknown>>, status: Route["status"] = 200): Route {
  return { method, path, role: null, status, handle };
}

const id = (input: HandlerInput): string => input.params["id"] ?? "";

export function routesCreator(useCases: UseCases): Route[] {
  return [
    // Sessions. Sign-up and sign-in are the only public routes.
    open("POST", "/auth/sign-up", (i) => useCases.signUp(signUpBody.parse(i.body)), 201),
    open("POST", "/auth/sign-in", (i) => useCases.signIn(signInBody.parse(i.body))),
    on("POST", "/auth/sign-out", "member", (_a, i) => useCases.signOut(i.token), 204),
    on("GET", "/me", "member", (a) => useCases.me(a)),

    // Offers: members browse the live ones; a manager may ask for every status with `all=1`.
    on("GET", "/offers", "member", (a, i) => useCases.listOffers(a, listOffersQuery.parse(i.query))),
    on("GET", "/offers/:id", "member", (a, i) => useCases.getOffer(a, id(i))),
    on("POST", "/offers/:id/activate", "member", (a, i) => useCases.activateOffer(a, id(i)), 201),

    // Everything under /me is the signed-in member's own data and nothing else.
    on("GET", "/me/activations", "member", (a, i) => useCases.listActivations(a, pageQuery.parse(i.query))),
    on("GET", "/me/cashbacks", "member", (a, i) => useCases.listCashbacks(a, listCashbacksQuery.parse(i.query))),
    on("GET", "/me/cashbacks/:id", "member", (a, i) => useCases.getCashback(a, id(i))),
    on("GET", "/me/wallet", "member", (a, i) => useCases.getWallet(a, pageQuery.parse(i.query))),
    on("GET", "/me/payouts", "member", (a, i) => useCases.listPayouts(a, listPayoutsQuery.parse(i.query))),
    on("POST", "/me/payouts", "member", (a, i) => useCases.requestPayout(a, requestPayoutBody.parse(i.body)), 201),
    on("GET", "/me/claims", "member", (a, i) => useCases.listClaims(a, listClaimsQuery.parse(i.query))),
    on("POST", "/me/claims", "member", (a, i) => useCases.fileClaim(a, fileClaimBody.parse(i.body)), 201),
    on("GET", "/me/claims/:id", "member", (a, i) => useCases.getClaim(a, id(i))),
    on("GET", "/me/referrals", "member", (a) => useCases.getReferrals(a)),

    // The claims queue, for agents.
    on("GET", "/claims", "agent", (a, i) => useCases.listClaims(a, listClaimsQuery.parse(i.query))),
    on("GET", "/claims/:id", "agent", (a, i) => useCases.getClaim(a, id(i))),
    on("POST", "/claims/:id/assign", "agent", (a, i) => useCases.assignClaim(a, id(i), assignClaimBody.parse(i.body))),
    on("POST", "/claims/:id/acknowledge", "agent", (a, i) => useCases.acknowledgeClaim(a, id(i))),
    on("POST", "/claims/:id/raise", "agent", (a, i) => useCases.raiseClaim(a, id(i), raiseClaimBody.parse(i.body ?? {}))),
    on("POST", "/claims/:id/decline", "agent", (a, i) => useCases.declineClaim(a, id(i), declineClaimBody.parse(i.body))),
    on("POST", "/claims/:id/credit", "agent", (a, i) => useCases.creditClaim(a, id(i))),
    on("GET", "/users/:id/wallet", "agent", (a, i) => useCases.getWalletOf(a, id(i), pageQuery.parse(i.query))),
    on("GET", "/users/:id/cashbacks", "agent", (a, i) => useCases.listCashbacksOf(a, id(i), listCashbacksQuery.parse(i.query))),
    on("GET", "/merchants", "agent", (a) => useCases.listMerchants(a)),

    // The catalogue, for managers.
    on("POST", "/merchants", "manager", (a, i) => useCases.createMerchant(a, createMerchantBody.parse(i.body)), 201),
    on("POST", "/offers", "manager", (a, i) => useCases.createOffer(a, createOfferBody.parse(i.body)), 201),
    on("PATCH", "/offers/:id", "manager", (a, i) => useCases.updateOffer(a, id(i), updateOfferBody.parse(i.body))),
    on("POST", "/offers/:id/publish", "manager", (a, i) => useCases.publishOffer(a, id(i))),
    on("POST", "/offers/:id/pause", "manager", (a, i) => useCases.pauseOffer(a, id(i))),
    on("POST", "/offers/:id/resume", "manager", (a, i) => useCases.resumeOffer(a, id(i))),
    on("POST", "/offers/:id/end", "manager", (a, i) => useCases.endOffer(a, id(i))),
    on("POST", "/offers/:id/boosts", "manager", (a, i) => useCases.addBoost(a, id(i), addBoostBody.parse(i.body)), 201),

    // Manual decisions on a cashback.
    on("POST", "/cashbacks/:id/validate", "manager", (a, i) => useCases.validateCashback(a, id(i), decisionBody.parse(i.body))),
    on("POST", "/cashbacks/:id/refuse", "manager", (a, i) => useCases.refuseCashback(a, id(i), decisionBody.parse(i.body))),
    on("POST", "/cashbacks/:id/cancel", "manager", (a, i) => useCases.cancelCashback(a, id(i), decisionBody.parse(i.body))),

    // The settlement pipeline and its queue.
    on("POST", "/imports", "manager", (a, i) => useCases.importFile(a, importBody.parse(i.body)), 201),
    on("GET", "/imports", "manager", (a, i) => useCases.listImports(a, pageQuery.parse(i.query))),
    on("GET", "/imports/:id", "manager", (a, i) => useCases.getImport(a, id(i))),
    on("GET", "/transactions", "manager", (a, i) => useCases.listTransactions(a, listTransactionsQuery.parse(i.query))),
    on("GET", "/transactions/:id", "manager", (a, i) => useCases.getTransaction(a, id(i))),
    on("POST", "/transactions/:id/match", "manager", (a, i) => useCases.matchTransaction(a, id(i), matchTransactionBody.parse(i.body))),
    on("POST", "/transactions/:id/ignore", "manager", (a, i) => useCases.ignoreTransaction(a, id(i), ignoreTransactionBody.parse(i.body))),

    // The payouts queue.
    on("GET", "/payouts", "manager", (a, i) => useCases.listPayouts(a, listPayoutsQuery.parse(i.query))),
    on("POST", "/payouts/:id/check", "manager", (a, i) => useCases.checkPayout(a, id(i))),
    on("POST", "/payouts/:id/send", "manager", (a, i) => useCases.sendPayout(a, id(i))),
    on("POST", "/payouts/:id/fail", "manager", (a, i) => useCases.failPayout(a, id(i), failPayoutBody.parse(i.body))),

    // Reports and the audit log.
    on("GET", "/reports/overview", "manager", (a) => useCases.getOverview(a)),
    on("GET", "/reports/margin", "manager", (a, i) => useCases.getMargin(a, marginQuery.parse(i.query))),
    on("GET", "/reports/reconciliation", "manager", (a) => useCases.getReconciliation(a)),
    on("GET", "/audit", "manager", (a, i) => useCases.listAudit(a, auditQuery.parse(i.query))),
  ];
}
