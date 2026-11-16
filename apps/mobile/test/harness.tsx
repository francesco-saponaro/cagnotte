import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { Pressable } from "react-native";
import { apiClientCreator } from "@/api/client";
import type { Method, Query, Transport, TransportRequest } from "@/api/transport";
import { AppProviders, makeQueryClient } from "@/app-context";
import { memoryStorage, sessionStoreCreator, type SessionStore } from "@/auth/session";
import type { Nav } from "@/ui/nav";
import { marie } from "./fixtures";

/*
 * Screens under test talk to a fake transport: a table of "METHOD /path" handlers that answer with
 * fixture rows or with the API's error shape, and a log of every call so a test can check what the
 * screen sent. Navigation is recorded the same way.
 */

export type Handler = (request: { query: Query; body: unknown; params: string[] }) => unknown | Promise<unknown>;

export class Refusal {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details?: unknown,
  ) {}
}

export const refuse = (status: number, code: string, message: string, details?: unknown) => {
  throw new Refusal(status, code, message, details);
};

export interface FakeApi {
  transport: Transport;
  calls: TransportRequest[];
}

/** Routes are "GET /offers" or "GET /offers/:id"; `:name` segments land in `params` in order. */
export function fakeApi(routes: Record<string, Handler>): FakeApi {
  const calls: TransportRequest[] = [];
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ") as [Method, string];
    const parts = pattern.split("/");
    return { method, parts, handler };
  });
  const transport: Transport = {
    async request(request) {
      calls.push(request);
      const path = request.path.split("/");
      for (const route of table) {
        if (route.method !== request.method || route.parts.length !== path.length) continue;
        const params: string[] = [];
        const hit = route.parts.every((part, i) => (part.startsWith(":") ? (params.push(path[i] ?? ""), true) : part === path[i]));
        if (!hit) continue;
        try {
          const body = await route.handler({ query: request.query ?? {}, body: request.body, params });
          return { status: body === undefined ? 204 : 200, body };
        } catch (error) {
          if (error instanceof Refusal) return { status: error.status, body: { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } } };
          throw error;
        }
      }
      return { status: 404, body: { error: { code: "not_found", message: `no fake route for ${request.method} ${request.path}` } } };
    },
  };
  return { transport, calls };
}

export interface FakeNav extends Nav {
  pushed: string[];
  replaced: string[];
  backs: number;
}

export function fakeNav(): FakeNav {
  const nav: FakeNav = {
    pushed: [],
    replaced: [],
    backs: 0,
    push: (href) => nav.pushed.push(href),
    replace: (href) => nav.replaced.push(href),
    back: () => {
      nav.backs += 1;
    },
    Link: ({ href, children, style, testID, ...rest }) => (
      <Pressable role="link" aria-label={rest["aria-label"]} aria-current={rest["aria-current"]} onPress={() => nav.pushed.push(href)} style={style} {...(testID ? { testID } : {})}>
        {children}
      </Pressable>
    ),
  };
  return nav;
}

export interface Rendered extends ReturnType<typeof render> {
  api: FakeApi;
  nav: FakeNav;
  session: SessionStore;
}

export async function signedIn(user = marie): Promise<SessionStore> {
  const store = sessionStoreCreator(memoryStorage());
  await store.signIn({ user, token: "tok", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  return store;
}

export async function signedOut(): Promise<SessionStore> {
  const store = sessionStoreCreator(memoryStorage());
  await store.load();
  return store;
}

export async function renderApp(ui: ReactElement, options: { routes?: Record<string, Handler>; session?: SessionStore; nav?: FakeNav } & RenderOptions = {}): Promise<Rendered> {
  const { routes = {}, session: givenSession, nav: givenNav, ...renderOptions } = options;
  const api = fakeApi(routes);
  const nav = givenNav ?? fakeNav();
  const session = givenSession ?? (await signedIn());
  const client = apiClientCreator(api.transport, () => session.get().token);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders api={client} session={session} nav={nav} queryClient={makeQueryClient()}>
      {children}
    </AppProviders>
  );
  const rendered = render(ui, { wrapper, ...renderOptions });
  return Object.assign(rendered, { api, nav, session });
}

export const page = <T,>(items: T[], total = items.length, pageNo = 1, pageSize = 20) => ({ items, total, page: pageNo, pageSize });
