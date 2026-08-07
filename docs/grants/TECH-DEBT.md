# Grant Platform Technical Debt

Only active, explicitly accepted debt belongs here. Historical work belongs in
Git and closed issues.

| ID | Problem | Temporary containment | Permanent resolution | Owner | Expiry/removal condition | Status |
|---|---|---|---|---|---|---|
| None | No grant implementation debt is accepted at baseline | N/A | N/A | N/A | N/A | Closed |

## Rules

- Every temporary path has an owner, expiry, and removal condition.
- Debt cannot waive authorization, revision concurrency, auditability,
  non-fabrication, or human-approval rules.
- A feature is not complete while its temporary parallel authority is active.
- Each delivery phase reviews duplicate ownership, dead code, stale flags,
  unconnected features, hidden fallbacks, and duplicate model calls.
- A checker must have quality metrics and an explicit downgrade/removal path.
