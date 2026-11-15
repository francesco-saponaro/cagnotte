import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from "react";
import { isApiError, type ApiClient } from "./api/client";
import type { SessionState, SessionStore } from "./auth/session";
import { NavProvider, type Nav } from "./ui/nav";

/*
 * What every screen may ask for: the API client, the session and navigation. The root layout
 * builds the real ones once; the tests build fakes. This is the app's composition root in the sense
 * of decision record 1: the only place that decides which transport is real.
 */

const ApiContext = createContext<ApiClient | null>(null);
const SessionContext = createContext<SessionStore | null>(null);

export interface AppDeps {
  api: ApiClient;
  session: SessionStore;
  nav: Nav;
  queryClient: QueryClient;
}

/** A 401 from any call means the session is dead on the server: `onUnauthorized` drops it here too. */
export function makeQueryClient(onUnauthorized?: () => void): QueryClient {
  const onError = (error: unknown) => {
    if (onUnauthorized && isApiError(error) && error.status === 401) onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } },
  });
}

export function AppProviders({ api, session, nav, queryClient, children }: PropsWithChildren<AppDeps>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <SessionContext.Provider value={session}>
          <NavProvider nav={nav}>{children}</NavProvider>
        </SessionContext.Provider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs AppProviders above it");
  return api;
}

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSessionStore needs AppProviders above it");
  return store;
}

export function useSession(): SessionState {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
