import type { DomainError, ErrorCode, Result } from "@cagnotte/domain";
import type { FastifyReply } from "fastify";

/** The one error shape of the API: `{ error: { code, message, details? } }`. */
export function errorBody(code: ErrorCode | "rate_limited" | "internal", message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

const STATUS: Record<ErrorCode | "rate_limited" | "internal", number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rule: 422,
  rate_limited: 429,
  internal: 500,
};

export const statusOf = (code: keyof typeof STATUS): number => STATUS[code];

export function sendError(reply: FastifyReply, error: DomainError) {
  return reply.status(statusOf(error.code)).send(errorBody(error.code, error.message, error.details));
}

/** A use case's result as a response: the value with `status`, or the error mapped to its status. */
export function send<T>(reply: FastifyReply, result: Result<T>, status = 200) {
  if (!result.ok) return sendError(reply, result.error);
  if (status === 204) return reply.status(204).send();
  return reply.status(status).send(result.value);
}
