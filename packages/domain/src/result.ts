/*
 * Rules fail as values, not as exceptions: a use case returns `ok(value)` or `fail(code, message)`,
 * and the HTTP layer maps the code to a status. Nothing in the domain throws for a business reason.
 */

export type ErrorCode = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rule";

export interface DomainError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function fail<T = never>(code: ErrorCode, message: string, details?: unknown): Result<T> {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFound = <T = never>(what: string): Result<T> => fail("not_found", `${what} not found`);
export const forbidden = <T = never>(message = "not allowed"): Result<T> => fail("forbidden", message);
