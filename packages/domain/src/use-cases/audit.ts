import type { Actor, AuditEntry } from "../entities.js";
import type { Deps, Page, PageQuery } from "../ports.js";
import { pageQuery } from "../ports.js";
import { ok, type Result } from "../result.js";
import { requireRole } from "./access.js";

export interface ListAuditQuery extends Partial<PageQuery> {
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
}

/** The audit log, for managers: every transition, who made it and why. */
export function auditUseCasesCreator(deps: Deps) {
  const listAudit = async (actor: Actor, query: ListAuditQuery): Promise<Result<Page<AuditEntry>>> => {
    const denied = requireRole<Page<AuditEntry>>(actor, "manager");
    if (denied) return denied;
    return ok(
      await deps.ports.audit.list({
        ...pageQuery(query),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
      }),
    );
  };
  return { listAudit };
}
