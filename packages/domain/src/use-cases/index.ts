import type { Deps } from "../ports.js";
import { authUseCasesCreator } from "./auth.js";
import { offerUseCasesCreator } from "./offers.js";
import { walletUseCasesCreator } from "./wallet.js";
import { payoutUseCasesCreator } from "./payouts.js";
import { decisionUseCasesCreator } from "./decisions.js";
import { auditUseCasesCreator } from "./audit.js";
import { claimUseCasesCreator } from "./claims.js";
import { referralUseCasesCreator } from "./referrals.js";
import { catalogueUseCasesCreator } from "./catalogue.js";
import { reportUseCasesCreator } from "./reports.js";
import { importUseCasesCreator } from "./imports.js";
import { transactionUseCasesCreator } from "./transactions.js";
import { reconciliationUseCasesCreator } from "./reconciliation.js";

/** Every use case, wired to one set of ports. The API and the browser demo each call this once. */
export function useCasesCreator(deps: Deps) {
  return {
    ...authUseCasesCreator(deps),
    ...offerUseCasesCreator(deps),
    ...walletUseCasesCreator(deps),
    ...payoutUseCasesCreator(deps),
    ...decisionUseCasesCreator(deps),
    ...auditUseCasesCreator(deps),
    ...claimUseCasesCreator(deps),
    ...referralUseCasesCreator(deps),
    ...catalogueUseCasesCreator(deps),
    ...reportUseCasesCreator(deps),
    ...importUseCasesCreator(deps),
    ...transactionUseCasesCreator(deps),
    ...reconciliationUseCasesCreator(deps),
  };
}

export type UseCases = ReturnType<typeof useCasesCreator>;

export * from "./access.js";
export * from "./auth.js";
export * from "./offers.js";
export * from "./wallet.js";
export * from "./ledger.js";
export * from "./payouts.js";
export * from "./decisions.js";
export * from "./audit.js";
export * from "./claims.js";
export * from "./referrals.js";
export * from "./catalogue.js";
export * from "./reports.js";
export * from "./settlement.js";
export * from "./imports.js";
export * from "./transactions.js";
export * from "./reconciliation.js";
