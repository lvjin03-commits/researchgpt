import type { GrantWebSearchEgressAudit } from "../web-sources/query-audit-contracts.ts";

export interface GrantWebSearchEgressAuditRepository {
  append(event: GrantWebSearchEgressAudit): Promise<void>;
}
