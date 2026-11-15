import type { z } from "zod";
import { isApiError } from "../api/client";

/*
 * Forms validate with the API's own zod schemas before sending, so a field the server would refuse
 * is refused on the phone first with the same words; what the server still refuses (a rule, a 422)
 * comes back as one sentence for the form.
 */

export type FieldErrors = Record<string, string>;

export type Checked<T> = { ok: true; data: T; errors: FieldErrors } | { ok: false; data: null; errors: FieldErrors };

/** Runs the schema and returns the first message per field, keyed by the field's name. */
export function check<S extends z.ZodType>(schema: S, values: unknown): Checked<z.output<S>> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, data: null, errors };
}

/** What a form says when the API refuses: per field for a 400 with details, else one sentence. */
export function errorsFrom(error: unknown, fields: string[]): { form: string | null; fields: FieldErrors } {
  if (!isApiError(error)) return { form: error instanceof Error ? error.message : "something went wrong", fields: {} };
  const perField: FieldErrors = {};
  for (const field of fields) {
    const message = error.fieldMessage(field);
    if (message) perField[field] = message;
  }
  return { form: Object.keys(perField).length > 0 ? null : error.message, fields: perField };
}
