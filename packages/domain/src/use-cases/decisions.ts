import type { Actor, Cashback, CashbackStatus } from "../entities.js";
import type { Deps } from "../ports.js";
import { fail, notFound, type Result } from "../result.js";
import { requireRole } from "./access.js";
import { settlementCreator } from "./settlement.js";

/*
 * A manager deciding a cashback by hand, when the network is wrong or late. The move goes through
 * the same settlement step as the pipeline's, so the ledger entries, the audit row and the referral
 * bonus are the same whoever decided; a later network file leaves a manager's decision alone.
 */

export interface DecisionInput {
  reason: string;
}

export function decisionUseCasesCreator(deps: Deps) {
  const { unitOfWork } = deps;
  const settlement = settlementCreator(deps);

  async function decide(actor: Actor, cashbackId: string, to: CashbackStatus, input: DecisionInput, action: string): Promise<Result<Cashback>> {
    const denied = requireRole<Cashback>(actor, "manager");
    if (denied) return denied;
    const reason = input.reason.trim();
    if (reason.length === 0) return fail("invalid", "reason is required");
    return unitOfWork.run(async (tx) => {
      const found = await tx.cashbacks.findById(cashbackId);
      if (!found) return notFound("cashback");
      const { offer: _offer, ...cashback } = found;
      return settlement.changeStatus(tx, cashback, to, { decidedBy: "manager", reason, actor, action });
    });
  }

  const validateCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "validated", input, "cashback.validate");
  const refuseCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "refused", input, "cashback.refuse");
  const cancelCashback = (actor: Actor, cashbackId: string, input: DecisionInput) => decide(actor, cashbackId, "cancelled", input, "cashback.cancel");

  return { validateCashback, refuseCashback, cancelCashback };
}
