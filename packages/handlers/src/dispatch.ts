import { hasRole, type DomainError, type ErrorCode, type UseCases } from "@cagnotte/domain";
import { ZodError } from "zod";
import type { Method, Route } from "./routes.js";

/*
 * The part of a server that is not the server: find the route, read the bearer token, refuse a
 * missing session or a lower role before anything is looked up, parse the body and query with
 * the route's schema, call the use case and map its result to a status. The browser demo is this
 * function alone; the Fastify server does the same steps with Fastify's own hooks and uses the
 * error shape and the status table from here.
 */

export type ApiErrorCode = ErrorCode | "rate_limited" | "internal";

/** The one error shape of the API: `{ error: { code, message, details? } }`. */
export function errorBody(code: ApiErrorCode, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

const STATUS: Record<ApiErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rule: 422,
  rate_limited: 429,
  internal: 500,
};

export const statusOf = (code: ApiErrorCode): number => STATUS[code];

export const errorResponse = (error: DomainError) => ({ status: statusOf(error.code), body: errorBody(error.code, error.message, error.details) });

/** A `ZodError` as a 400 with one line per field, the same on the server and in the demo. */
export const invalidResponse = (error: ZodError) => ({
  status: 400,
  body: errorBody(
    "invalid",
    "the request is not valid",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  ),
});

export interface DispatchRequest {
  method: Method;
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  token: string | null;
}

export interface DispatchResponse {
  status: number;
  body: unknown;
}

export type Dispatch = (request: DispatchRequest) => Promise<DispatchResponse>;

interface Matched {
  route: Route;
  params: Record<string, string>;
}

/** The route whose segments fit the path, with the `:name` segments read off it. */
export function matchRoute(routes: Route[], method: Method, path: string): Matched | null {
  const parts = path.split("/");
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/");
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let hit = true;
    for (let i = 0; i < pattern.length && hit; i++) {
      const want = pattern[i] ?? "";
      const got = parts[i] ?? "";
      if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(got);
      else hit = want === got;
    }
    if (hit) return { route, params };
  }
  return null;
}

export function dispatcherCreator(routes: Route[], useCases: UseCases): Dispatch {
  return async ({ method, path, query, body, token }) => {
    const matched = matchRoute(routes, method, path);
    if (!matched) return { status: 404, body: errorBody("not_found", "no such route") };
    const { route, params } = matched;

    let actor = null;
    if (route.role) {
      const auth = token ? await useCases.authenticate(token) : null;
      if (!token || !auth || !auth.ok) return { status: 401, body: errorBody("unauthorized", "sign in first") };
      if (!hasRole(auth.value.actor, route.role)) return { status: 403, body: errorBody("forbidden", `${route.role} role required`) };
      actor = auth.value.actor;
    }

    try {
      const result = await route.handle({ params, query: query ?? {}, body, actor, token });
      if (!result.ok) return errorResponse(result.error);
      if (route.status === 204) return { status: 204, body: undefined };
      return { status: route.status, body: result.value };
    } catch (error) {
      if (error instanceof ZodError) return invalidResponse(error);
      throw error;
    }
  };
}
