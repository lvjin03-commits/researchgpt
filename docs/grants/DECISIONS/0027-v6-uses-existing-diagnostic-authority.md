# ADR 0027 — V6 uses the existing diagnostic authority

## Decision

Semantic Review V6 is a selectable implementation of the existing semantic
checker behind the existing diagnostics route and service. The sole runtime
selector is `selectGrantSemanticDiagnosticRuntime(ownerId)`.

V6 selection requires:

1. `GRANT_SEMANTIC_REVIEW_V6_MODE` to be `canary` or `on`;
2. `GRANT_SEMANTIC_REVIEW_V6_DATABASE_SCHEMA=051`;
3. for canary mode, the current owner to be in the explicit UUID cohort.

The selector fails closed. V6 off means the prior hierarchical/V3/V2 selection
continues unchanged.

## Rejected alternatives

- A V6 API route or button: duplicates the diagnostic authority.
- Selection inside the checker or API handler: lets downstream code reinterpret
  a composition decision.
- Enabling V6 from a public client variable: leaks a paid server decision into
  the browser and freezes it at build time.

## Consequences

Rollback is one server-side mode change. V6 may reuse the existing gateway,
image authorization, repository and UI projection, but none of those modules
may independently select a diagnostic version.
