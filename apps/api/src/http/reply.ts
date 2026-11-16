import type { DomainError, Result } from "@cagnotte/domain";
import { errorBody, statusOf } from "@cagnotte/handlers";
import type { FastifyReply } from "fastify";

export { errorBody, statusOf };

export function sendError(reply: FastifyReply, error: DomainError) {
  return reply.status(statusOf(error.code)).send(errorBody(error.code, error.message, error.details));
}

/** A use case's result as a response: the value with `status`, or the error mapped to its status. */
export function send<T>(reply: FastifyReply, result: Result<T>, status = 200) {
  if (!result.ok) return sendError(reply, result.error);
  if (status === 204) return reply.status(204).send();
  return reply.status(status).send(result.value);
}
