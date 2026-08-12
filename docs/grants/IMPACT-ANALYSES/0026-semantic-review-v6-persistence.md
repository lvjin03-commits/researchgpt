# Impact Analysis 0026: Semantic Review V6 persistence

## Problem

The V6 aggregate executor can expose a mature Fact Map or Scientific Review
checkpoint, but those checkpoints are process-local. A worker interruption can
therefore repeat paid stages, and a successful three-stage result has no atomic
durable representation.

## Authority and scope

- Grant Diagnostic Repository remains the only persistence owner.
- Revision Service remains the current-revision authority.
- The V6 executor owns provider calls and budgets; repositories never call a
  model or decide whether a retry is allowed.
- The existing diagnostic run and Finding envelope remain the compatibility
  projection. V6 scientific/narrative details are additive records, not a new
  user-facing diagnostic route.

## Changes

- Add revision/scope/input-bound V6 checkpoint records for Fact Map and
  Scientific Review maturity.
- Extend the existing diagnostic repository port and both current adapters.
- Add one PostgreSQL migration with owner-scoped checkpoint lookup and one
  atomic successful-execution RPC.
- Persist the run, compatibility Finding envelopes, V6 details and checkpoint
  consumption in one transaction after rechecking the current Revision.

## Non-goals

- No production selector, route, worker, feature flag or UI change.
- No Semantic V5 data rewrite and no deletion of historical Findings.
- No durable provider request/response prose telemetry.

## Risks and controls

- Stale diagnosis: checkpoint save, lookup and final commit require the same
  current source Revision.
- Cross-scope reuse: input and location-scope fingerprints are both required.
- Partial save: the successful execution RPC either commits all run/Finding/
  detail/checkpoint changes or rolls them all back.
- Parallel authority: only repository methods invoke persistence RPCs.

## Rollback

Remove the additive repository methods, V6 persistence assembly, tests and
migration objects. No production selector uses them in this step.

## Production verification

Migration 051 was applied on 2026-08-12 after confirming that migrations
001-050 already matched the linked production project. The repeatable
`test:grant-semantic-review-v6:postgres` probe verified checkpoint round-trip,
owner isolation, stale-Revision rejection, transaction rollback, successful
atomic persistence and both V6 Finding families, then removed its temporary
users and document. V6 runtime selection remains disabled.
