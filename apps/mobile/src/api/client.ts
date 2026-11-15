import type { Query, Transport, TransportRequest } from "./transport";

/*
 * The one way a screen reaches the API. `get` and `post` return the response body typed by the
 * caller, or throw an `ApiError` carrying the API's own code and message, so a form can show
 * "only 1,50 € is available" exactly as the server said it.
 */

export type ApiErrorCode = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rule" | "rate_limited" | "internal" | "network";

export interface FieldIssue {
  path: (string | number)[];
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The message a 400 gave for one field, when the details are zod issues. */
  fieldMessage(field: string): string | null {
    if (!Array.isArray(this.details)) return null;
    for (const issue of this.details as Partial<FieldIssue>[]) {
      if (Array.isArray(issue.path) && issue.path[0] === field && typeof issue.message === "string") return issue.message;
    }
    return null;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export interface ApiClient {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T = void>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

function errorFrom(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
  const code = (error?.code ?? "internal") as ApiErrorCode;
  return new ApiError(status, code, error?.message ?? `the API answered ${status}`, error?.details);
}

export function apiClientCreator(transport: Transport, getToken: () => string | null): ApiClient {
  async function call<T>(request: Omit<TransportRequest, "token">): Promise<T> {
    let response;
    try {
      response = await transport.request({ ...request, token: getToken() });
    } catch (cause) {
      throw new ApiError(0, "network", cause instanceof Error && cause.message ? `could not reach the API: ${cause.message}` : "could not reach the API");
    }
    if (response.status >= 400) throw errorFrom(response.status, response.body);
    return response.body as T;
  }

  return {
    get: (path, query) => call({ method: "GET", path, query }),
    post: (path, body) => call({ method: "POST", path, body }),
    patch: (path, body) => call({ method: "PATCH", path, body }),
  };
}
