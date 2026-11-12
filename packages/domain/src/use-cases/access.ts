import type { Actor, AuditEntry, UserRole } from "../entities.js";
import type { Clock, IdGenerator, Ports } from "../ports.js";
import { fail, type Result } from "../result.js";

const RANK: Record<UserRole, number> = { member: 0, agent: 1, manager: 2 };

/** True when the actor's role is `role` or above: a manager can do everything an agent can. */
export function hasRole(actor: Actor, role: UserRole): boolean {
  return RANK[actor.role] >= RANK[role];
}

export function requireRole<T = never>(actor: Actor, role: UserRole): Result<T> | null {
  return hasRole(actor, role) ? null : fail("forbidden", `${role} role required`);
}

/** Own data, or any data for staff of at least `staffRole`. */
export function canRead(actor: Actor, ownerId: string, staffRole: UserRole = "agent"): boolean {
  return actor.id === ownerId || hasRole(actor, staffRole);
}

export interface AuditInput {
  actor: Actor | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Every transition and every write that matters goes through here, inside the same unit of work. */
export async function writeAudit(ports: Ports, ids: IdGenerator, clock: Clock, input: AuditInput): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: ids.id("aud_"),
    actorId: input.actor?.id ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    at: clock.now(),
  };
  await ports.audit.insert(entry);
  return entry;
}
