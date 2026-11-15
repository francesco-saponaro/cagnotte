/*
 * How the app reaches the use cases. Over HTTP the transport is `fetch` against the API; in demo
 * mode it will be the same use cases running in the browser on PGlite. The screens never know
 * which: they talk to the client in `client.ts`, which talks to one of these.
 */

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export type Query = Record<string, string | number | boolean | undefined>;

export interface TransportRequest {
  method: Method;
  path: string;
  query?: Query | undefined;
  body?: unknown;
  token: string | null;
}

export interface TransportResponse {
  status: number;
  /** The parsed JSON body, or undefined for an empty response. */
  body: unknown;
}

export interface Transport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

/** `?q=shoes&page=2`: defined values only, in the order given. */
export function queryString(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
