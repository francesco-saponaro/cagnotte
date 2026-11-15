import { apiClientCreator } from "./api/client";
import { httpTransportCreator } from "./api/http";
import type { Transport } from "./api/transport";
import { sessionStoreCreator } from "./auth/session";
import { platformStorage } from "./auth/storage";
import { makeQueryClient, type AppDeps } from "./app-context";
import type { Nav } from "./ui/nav";

/*
 * The app's wiring, built once when it starts. `EXPO_PUBLIC_API_URL` names the API; when it is empty
 * the app runs in demo mode, where the same use cases will run in the browser (the transport for
 * that lands with demo mode itself).
 */

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export const demoMode = API_URL.length === 0;

function transportFor(apiUrl: string): Transport {
  if (apiUrl.length > 0) return httpTransportCreator(apiUrl);
  return {
    async request() {
      return { status: 503, body: { error: { code: "internal", message: "Demo mode is not available yet; set EXPO_PUBLIC_API_URL to an API." } } };
    },
  };
}

export function buildDeps(nav: Nav): AppDeps {
  const session = sessionStoreCreator(platformStorage());
  const api = apiClientCreator(transportFor(API_URL), () => session.get().token);
  // A sign-in attempt answers 401 too; that one is the form's to show, not a reason to sign out.
  const queryClient = makeQueryClient(() => {
    if (session.get().status === "signed-in") void session.signOut();
  });
  return { api, session, nav, queryClient };
}
