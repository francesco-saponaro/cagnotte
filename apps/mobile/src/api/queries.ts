import type { FileClaimBody, RequestPayoutBody, SignInBody } from "@cagnotte/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, useSessionStore } from "../app-context";
import type {
  ActivationRow,
  ActivationWithOfferRow,
  CashbackDetailRow,
  CashbackRow,
  ClaimDetailRow,
  ClaimRow,
  OfferDetailRow,
  OfferRow,
  Page,
  PayoutRow,
  ReferralsRow,
  SignedInRow,
  WalletRow,
} from "./types";

/*
 * One hook per route the member app calls. The keys are the routes, so a write invalidates exactly
 * the reads it changes: an activation touches the activations; a payout request touches the wallet
 * and the payouts; a claim touches the claims.
 */

export interface OffersQuery {
  q?: string | undefined;
  category?: string | undefined;
  kind?: "online" | "voucher" | undefined;
  sort?: "rate" | "newest" | "name" | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export const keys = {
  me: ["me"] as const,
  offers: (query: OffersQuery) => ["offers", query] as const,
  offer: (id: string) => ["offers", id] as const,
  activations: ["me", "activations"] as const,
  wallet: ["me", "wallet"] as const,
  cashbacks: (status?: string, page?: number) => ["me", "cashbacks", status ?? "all", page ?? 1] as const,
  cashback: (id: string) => ["me", "cashbacks", id] as const,
  payouts: ["me", "payouts"] as const,
  claims: (page?: number) => ["me", "claims", page ?? 1] as const,
  claim: (id: string) => ["me", "claims", id] as const,
  referrals: ["me", "referrals"] as const,
};

export function useOffers(query: OffersQuery) {
  const api = useApi();
  return useQuery({ queryKey: keys.offers(query), queryFn: () => api.get<Page<OfferRow>>("/offers", { ...query }) });
}

export function useOffer(id: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.offer(id), queryFn: () => api.get<OfferDetailRow>(`/offers/${id}`) });
}

export function useActivate(offerId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ActivationRow>(`/offers/${offerId}/activate`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.activations }),
  });
}

export function useActivations() {
  const api = useApi();
  return useQuery({ queryKey: keys.activations, queryFn: () => api.get<Page<ActivationWithOfferRow>>("/me/activations", { pageSize: 50 }) });
}

export function useWallet() {
  const api = useApi();
  return useQuery({ queryKey: keys.wallet, queryFn: () => api.get<WalletRow>("/me/wallet", { pageSize: 50 }) });
}

export function useCashbacks(status?: CashbackRow["status"], page = 1) {
  const api = useApi();
  return useQuery({ queryKey: keys.cashbacks(status, page), queryFn: () => api.get<Page<CashbackRow>>("/me/cashbacks", { status, page, pageSize: 20 }) });
}

export function useCashback(id: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.cashback(id), queryFn: () => api.get<CashbackDetailRow>(`/me/cashbacks/${id}`) });
}

export function usePayouts() {
  const api = useApi();
  return useQuery({ queryKey: keys.payouts, queryFn: () => api.get<Page<PayoutRow>>("/me/payouts", { pageSize: 50 }) });
}

export function useRequestPayout() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestPayoutBody) => api.post<PayoutRow>("/me/payouts", body),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: keys.wallet }), client.invalidateQueries({ queryKey: keys.payouts })]),
  });
}

export function useClaims(page = 1) {
  const api = useApi();
  return useQuery({ queryKey: keys.claims(page), queryFn: () => api.get<Page<ClaimRow>>("/me/claims", { page, pageSize: 20 }) });
}

export function useClaim(id: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.claim(id), queryFn: () => api.get<ClaimDetailRow>(`/me/claims/${id}`) });
}

/** The body goes over the wire with the date as ISO text; the schema's `coerce.date` reads it back. */
export type FileClaimWire = Omit<FileClaimBody, "orderedAt"> & { orderedAt: string };

export function useFileClaim() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: FileClaimWire) => api.post<ClaimDetailRow>("/me/claims", body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me", "claims"] }),
  });
}

export function useReferrals() {
  const api = useApi();
  return useQuery({ queryKey: keys.referrals, queryFn: () => api.get<ReferralsRow>("/me/referrals") });
}

export function useSignIn() {
  const api = useApi();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (body: SignInBody) => {
      const signedIn = await api.post<SignedInRow>("/auth/sign-in", body);
      await session.signIn(signedIn);
      return signedIn;
    },
  });
}

export function useSignOut() {
  const api = useApi();
  const session = useSessionStore();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // The session goes locally whatever the API says: a dead token is no reason to stay signed in.
      await api.post("/auth/sign-out").catch(() => undefined);
      await session.signOut();
      client.clear();
    },
  });
}
