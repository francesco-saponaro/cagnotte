import { queryString, type Transport } from "./transport";

/** The transport for a real API: `fetch` with the bearer token and JSON both ways. */
export function httpTransportCreator(baseUrl: string, fetchFn: typeof fetch = fetch): Transport {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async request({ method, path, query, body, token }) {
      const headers = new Headers({ accept: "application/json" });
      if (token) headers.set("authorization", `Bearer ${token}`);
      if (body !== undefined) headers.set("content-type", "application/json");
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await fetchFn(`${base}${path}${queryString(query)}`, init);
      if (response.status === 204) return { status: 204, body: undefined };
      const text = await response.text();
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: { code: "internal", message: text.slice(0, 200) } };
        }
      }
      return { status: response.status, body: parsed };
    },
  };
}
