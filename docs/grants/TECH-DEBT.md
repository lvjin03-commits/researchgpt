# Grant Platform Technical Debt

Only active, explicitly accepted debt belongs here. Historical work belongs in
Git and closed issues.

| ID | Problem | Temporary containment | Permanent resolution | Owner | Expiry/removal condition | Status |
|---|---|---|---|---|---|---|
| GRANT-DEBT-001 | Semantic diagnostics V2, V3, hierarchical, and V6 remain selectable production implementations. Their parallel execution paths increase maintenance cost and concentrate version-specific branching in the checker, model gateway, and diagnostic service. | Keep one server-owned runtime selector, explicit rollout and schema gates, and no runtime failure fallback between generations. All generations continue through the same route and diagnostic service authority. | Complete the measured V6 canary and acceptance review, retain only the historical readers required for stored results, then remove the V2, V3, and hierarchical execution paths and their rollout flags. | Grant Platform maintainers | Review by 2026-09-30; remove after V6 meets the documented quality, cost, and reliability thresholds and the agreed rollback window closes. | Active |

## Rules

- Every temporary path has an owner, expiry, and removal condition.
- Debt cannot waive authorization, revision concurrency, auditability,
  non-fabrication, or human-approval rules.
- A feature is not complete while its temporary parallel authority is active.
- Each delivery phase reviews duplicate ownership, dead code, stale flags,
  unconnected features, hidden fallbacks, and duplicate model calls.
- A checker must have quality metrics and an explicit downgrade/removal path.
