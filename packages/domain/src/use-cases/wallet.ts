import type { Actor, CashbackStatus, LedgerEntry } from "../entities.js";
import type { Balances, CashbackWithOffer, Deps, Page, PageQuery } from "../ports.js";
import { pageQuery } from "../ports.js";
import { forbidden, notFound, ok, type Result } from "../result.js";
import { canRead } from "./access.js";

/*
 * The pot. A balance is the sum of a bucket's entries, computed every time; nothing here is
 * stored, which is why the wallet can never disagree with the ledger.
 */

export interface Wallet {
  userId: string;
  balances: Balances;
  ledger: Page<LedgerEntry>;
}

export interface ListCashbacksQuery extends Partial<PageQuery> {
  status?: CashbackStatus | undefined;
}

export type CashbackDetail = CashbackWithOffer & { entries: LedgerEntry[] };

export function walletUseCasesCreator(deps: Deps) {
  const { ports } = deps;

  const walletOf = async (userId: string, query: Partial<PageQuery>): Promise<Wallet> => ({
    userId,
    balances: await ports.ledger.balances(userId),
    ledger: await ports.ledger.listByUser(userId, pageQuery(query)),
  });

  const getWallet = async (actor: Actor, query: Partial<PageQuery>): Promise<Result<Wallet>> => ok(await walletOf(actor.id, query));

  const getWalletOf = async (actor: Actor, userId: string, query: Partial<PageQuery>): Promise<Result<Wallet>> => {
    if (!canRead(actor, userId)) return forbidden();
    if (!(await ports.users.findById(userId))) return notFound("user");
    return ok(await walletOf(userId, query));
  };

  const listCashbacks = async (actor: Actor, query: ListCashbacksQuery): Promise<Result<Page<CashbackWithOffer>>> =>
    ok(await ports.cashbacks.list({ ...pageQuery(query), userId: actor.id, ...(query.status ? { status: query.status } : {}) }));

  const listCashbacksOf = async (actor: Actor, userId: string, query: ListCashbacksQuery): Promise<Result<Page<CashbackWithOffer>>> => {
    if (!canRead(actor, userId)) return forbidden();
    if (!(await ports.users.findById(userId))) return notFound("user");
    return ok(await ports.cashbacks.list({ ...pageQuery(query), userId, ...(query.status ? { status: query.status } : {}) }));
  };

  const getCashback = async (actor: Actor, cashbackId: string): Promise<Result<CashbackDetail>> => {
    const cashback = await ports.cashbacks.findById(cashbackId);
    if (!cashback) return notFound("cashback");
    if (!canRead(actor, cashback.userId)) return forbidden();
    const entries = await ports.ledger.listByRef("cashback", cashback.id);
    return ok({ ...cashback, entries });
  };

  return { getWallet, getWalletOf, listCashbacks, listCashbacksOf, getCashback };
}
