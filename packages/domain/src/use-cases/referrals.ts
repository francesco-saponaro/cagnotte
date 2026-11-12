import type { Actor, ReferralStatus } from "../entities.js";
import type { Deps } from "../ports.js";
import { fail, ok, type Result } from "../result.js";
import { REFERRAL_CODE_LIMIT } from "./auth.js";

/*
 * Refer a friend, as the member sees it: the code to share, who signed up with it and where each
 * referral stands, and the bonuses paid so far. Validating a referral and paying the bonuses is the
 * settlement pipeline's job, because it happens when the referee's cashback validates.
 */

export interface ReferralsView {
  code: string;
  /** How many more sign-ups the code accepts. */
  remaining: number;
  referees: { displayName: string; status: ReferralStatus; createdAt: Date; validatedAt: Date | null; expiresAt: Date | null }[];
  /** Every referral bonus paid to this member, as referrer or as referee. */
  bonusCents: number;
}

export function referralUseCasesCreator(deps: Deps) {
  const { ports } = deps;

  const getReferrals = async (actor: Actor): Promise<Result<ReferralsView>> => {
    const user = await ports.users.findById(actor.id);
    if (!user) return fail("unauthorized", "sign in first");
    const referrals = await ports.referrals.listByReferrer(user.id);
    return ok({
      code: user.referralCode,
      remaining: Math.max(0, REFERRAL_CODE_LIMIT - referrals.length),
      referees: referrals.map((r) => ({ displayName: r.referee.displayName, status: r.status, createdAt: r.createdAt, validatedAt: r.validatedAt, expiresAt: r.expiresAt })),
      bonusCents: await ports.ledger.sumByKind(user.id, "referral_bonus"),
    });
  };

  return { getReferrals };
}
