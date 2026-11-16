import type { AddBoostBody, CreateOfferBody, ImportBody, UpdateOfferBody } from "@cagnotte/contracts";
import type { ClaimDeclineReason } from "@cagnotte/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../app-context";
import type { CashbackRow, ClaimDetailRow, ClaimRow, ImportBatchRow, MarginReportRow, MerchantRow, OfferDetailRow, OfferRow, OverviewRow, Page, PayoutRow, PayoutWithMemberRow, ReconciliationRow, TransactionDetailRow, TransactionPlainRow, TransactionRow, WalletRow } from "./types";
import { keys as memberKeys } from "./queries";

/*
 * One hook per back-office route, keyed the same way as the member's: the key is the route, so a
 * write invalidates exactly the reads it changes. A claim transition touches the claims and the
 * member's wallet; an import touches the imports, the transactions and the reports; a payout
 * transition touches the payouts queue and the overview.
 */

export interface ClaimsQueueQuery {
  status?: ClaimRow["status"] | undefined;
  assignee?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface TransactionsQuery {
  match?: TransactionRow["matchStatus"] | undefined;
  network?: TransactionRow["network"] | undefined;
  merchant?: string | undefined;
  batch?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface CatalogueQuery {
  q?: string | undefined;
  kind?: OfferRow["kind"] | undefined;
  category?: string | undefined;
  sort?: "rate" | "newest" | "name" | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export const opsKeys = {
  claims: (query: ClaimsQueueQuery) => ["ops", "claims", query] as const,
  claim: (id: string) => ["ops", "claims", id] as const,
  memberWallet: (userId: string) => ["ops", "users", userId, "wallet"] as const,
  memberCashbacks: (userId: string) => ["ops", "users", userId, "cashbacks"] as const,
  imports: (page: number) => ["ops", "imports", page] as const,
  import: (id: string) => ["ops", "imports", id] as const,
  transactions: (query: TransactionsQuery) => ["ops", "transactions", query] as const,
  transaction: (id: string) => ["ops", "transactions", id] as const,
  payouts: (status: string | undefined, page: number) => ["ops", "payouts", status ?? "all", page] as const,
  merchants: ["ops", "merchants"] as const,
  catalogue: (query: CatalogueQuery) => ["ops", "catalogue", query] as const,
  overview: ["ops", "reports", "overview"] as const,
  margin: ["ops", "reports", "margin"] as const,
  reconciliation: ["ops", "reports", "reconciliation"] as const,
};

// The claims queue.

export function useClaimsQueue(query: ClaimsQueueQuery) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.claims(query), queryFn: () => api.get<Page<ClaimRow>>("/claims", { ...query }) });
}

export function useClaimCase(id: string) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.claim(id), queryFn: () => api.get<ClaimRow>(`/claims/${id}`) });
}

export function useMemberWallet(userId: string) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.memberWallet(userId), queryFn: () => api.get<WalletRow>(`/users/${userId}/wallet`, { pageSize: 10 }), enabled: userId.length > 0 });
}

export function useMemberCashbacks(userId: string) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.memberCashbacks(userId), queryFn: () => api.get<Page<CashbackRow>>(`/users/${userId}/cashbacks`, { pageSize: 50 }), enabled: userId.length > 0 });
}

export type ClaimMove = { kind: "assign"; assigneeId: string } | { kind: "acknowledge" } | { kind: "raise"; networkTransactionId?: string | undefined } | { kind: "credit" } | { kind: "decline"; reason: ClaimDeclineReason };

/** One mutation for the five moves of a claim; the queue, the claim and the member's wallet are refreshed after. */
export function useMoveClaim(id: string, userId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (move: ClaimMove) => {
      switch (move.kind) {
        case "assign":
          return api.post<ClaimDetailRow>(`/claims/${id}/assign`, { assigneeId: move.assigneeId });
        case "acknowledge":
          return api.post<ClaimDetailRow>(`/claims/${id}/acknowledge`);
        case "raise":
          return api.post<ClaimDetailRow>(`/claims/${id}/raise`, move.networkTransactionId ? { networkTransactionId: move.networkTransactionId } : {});
        case "credit":
          return api.post<ClaimDetailRow>(`/claims/${id}/credit`);
        case "decline":
          return api.post<ClaimDetailRow>(`/claims/${id}/decline`, { reason: move.reason });
      }
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["ops", "claims"] }),
        client.invalidateQueries({ queryKey: ["ops", "users", userId] }),
        client.invalidateQueries({ queryKey: ["ops", "transactions"] }),
        client.invalidateQueries({ queryKey: ["ops", "reports"] }),
      ]),
  });
}

// The settlement pipeline.

export function useImports(page = 1) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.imports(page), queryFn: () => api.get<Page<ImportBatchRow>>("/imports", { page, pageSize: 20 }) });
}

export function useImport(id: string) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.import(id), queryFn: () => api.get<ImportBatchRow>(`/imports/${id}`) });
}

export function useImportFile() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportBody) => api.post<ImportBatchRow>("/imports", body),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["ops"] }), client.invalidateQueries({ queryKey: memberKeys.wallet })]),
  });
}

export function useTransactions(query: TransactionsQuery, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.transactions(query), queryFn: () => api.get<Page<TransactionRow>>("/transactions", { ...query }), enabled });
}

export function useTransaction(id: string) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.transaction(id), queryFn: () => api.get<TransactionDetailRow>(`/transactions/${id}`) });
}

export type TransactionMove = { kind: "match"; activationId: string } | { kind: "ignore"; reason: string };

export function useMoveTransaction(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (move: TransactionMove) => (move.kind === "match" ? api.post<TransactionPlainRow>(`/transactions/${id}/match`, { activationId: move.activationId }) : api.post<TransactionPlainRow>(`/transactions/${id}/ignore`, { reason: move.reason })),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["ops", "transactions"] }), client.invalidateQueries({ queryKey: ["ops", "reports"] })]),
  });
}

export type Decision = { kind: "validate" | "refuse" | "cancel"; reason: string };

/** A manager's decision on a cashback, from wherever the cashback is shown; everything that reads the ledger is refreshed. */
export function useDecideCashback(cashbackId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: Decision) => api.post<CashbackRow>(`/cashbacks/${cashbackId}/${decision.kind}`, { reason: decision.reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ops"] }),
  });
}

// Payouts.

export function usePayoutsQueue(status: PayoutRow["status"] | undefined, page = 1) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.payouts(status, page), queryFn: () => api.get<Page<PayoutWithMemberRow>>("/payouts", { status, page, pageSize: 20 }) });
}

export type PayoutMove = { kind: "check" } | { kind: "send" } | { kind: "fail"; reason: string };

export function useMovePayout() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, move }: { id: string; move: PayoutMove }) => api.post<PayoutRow>(`/payouts/${id}/${move.kind}`, move.kind === "fail" ? { reason: move.reason } : undefined),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["ops", "payouts"] }), client.invalidateQueries({ queryKey: ["ops", "reports"] })]),
  });
}

// The catalogue.

export function useMerchants() {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.merchants, queryFn: () => api.get<MerchantRow[]>("/merchants") });
}

export function useCatalogue(query: CatalogueQuery) {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.catalogue(query), queryFn: () => api.get<Page<OfferRow>>("/offers", { ...query, all: 1 }) });
}

/** The dates go over the wire as ISO text; the schema's `coerce.date` reads them back. */
export type CreateOfferWire = Omit<CreateOfferBody, "startsAt" | "endsAt"> & { startsAt: string; endsAt: string | null };
export type UpdateOfferWire = Omit<UpdateOfferBody, "startsAt" | "endsAt"> & { startsAt?: string | undefined; endsAt?: string | null | undefined };
export type AddBoostWire = Omit<AddBoostBody, "startsAt" | "endsAt"> & { startsAt: string; endsAt: string };

export function useCreateOffer() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOfferWire) => api.post<OfferRow>("/offers", body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ops", "catalogue"] }),
  });
}

export type OfferMove = { kind: "update"; body: UpdateOfferWire } | { kind: "publish" | "pause" | "resume" | "end" } | { kind: "boost"; body: AddBoostWire };

/** The edits and the moves of one offer; the offer, the catalogue and the members' view of it are refreshed after. */
export function useMoveOffer(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (move: OfferMove): Promise<OfferRow | OfferDetailRow["boosts"][number]> => {
      switch (move.kind) {
        case "update":
          return api.patch<OfferRow>(`/offers/${id}`, move.body);
        case "boost":
          return api.post<OfferDetailRow["boosts"][number]>(`/offers/${id}/boosts`, move.body);
        default:
          return api.post<OfferRow>(`/offers/${id}/${move.kind}`);
      }
    },
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["ops", "catalogue"] }), client.invalidateQueries({ queryKey: ["offers"] }), client.invalidateQueries({ queryKey: ["ops", "reports"] })]),
  });
}

// Reports.

export function useOverview() {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.overview, queryFn: () => api.get<OverviewRow>("/reports/overview") });
}

export function useMargin() {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.margin, queryFn: () => api.get<MarginReportRow>("/reports/margin") });
}

export function useReconciliation() {
  const api = useApi();
  return useQuery({ queryKey: opsKeys.reconciliation, queryFn: () => api.get<ReconciliationRow>("/reports/reconciliation") });
}
