# ADR 0035: Edit Session API requires explicit schema readiness

## Decision

Production Edit Session composition uses Supabase repositories and four authenticated Route Handler surfaces: create, restore, continue and apply. Exposure requires an independent feature flag and exact database readiness marker `053`.

All responses are `no-store`. Session lookup is owner-scoped in the repository and routes additionally require the document ID in the URL to match the persisted Session. No client request can select a model, safety state, Patch operation or Revision ID.

## Consequences

Code may deploy safely before migration or rollout. Refresh recovery is possible once schema 053 is applied. Schema 054 reserves confirmed web-source provenance, but production web acquisition stays unavailable until a hardened search/fetch adapter and dedicated routes are approved.

