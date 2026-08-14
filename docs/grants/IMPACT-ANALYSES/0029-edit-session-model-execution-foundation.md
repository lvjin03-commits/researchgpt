# Impact Analysis 0029 — Edit Session model-execution foundation

## Change

Add the server-owned `grant.edit_session.turn` operation policy, a bounded
two-attempt model executor, and an owner-scoped `grant_model_calls` telemetry
repository. This step does not add Edit Session persistence, a route, UI,
evidence admission, web access, or canonical-content writes.

## Authority

- The operation registry owns provider, model, retry categories and attempt
  ceiling for the operation.
- Grant Model Data Gateway remains the only future caller allowed to assemble
  authorized model context. The executor receives safe hashes and identifiers,
  never grant prose or evidence excerpts.
- Patch Policy and Revision Service remain the only path to canonical content.
- The model-call repository records execution facts; it cannot select a model,
  retry, authorize data or interpret output.

## Failure behavior

The executor persists a `started` attempt before invoking the provider. Failure
to create that record prevents the paid call. Each provider attempt is closed
as `succeeded` or `failed`. Only policy-listed categories may consume the one
additional attempt. A successful provider response is not returned if its
completion telemetry cannot be persisted.

## Compatibility and rollback

No current Patch or diagnostic traffic is moved in this step. Migration 052 is
additive and may remain unused when rollout is off. Rollback removes future
Edit Session composition without changing canonical documents or historical
model-call telemetry.

