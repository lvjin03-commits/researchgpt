# Impact analysis 0069: Grant Assistant usage and delivery audit closure

## Problem

The model-call ledger retained token usage for provider-dispatched failures, but the standardized
usage observer ran only after successful attempts. Provider work that returned a refusal, filtered
output or terminal error could therefore be visible in Grant telemetry without reaching the shared
usage stream. Partial full-document delivery also retained coverage but not its safe terminal reason.

## Authority and boundary changes

- `GrantModelExecutor` remains the sole owner of attempt lifecycle and standardized usage emission.
- Every provider-dispatched attempt with known usage emits one idempotent usage event keyed by its
  model-call ID, regardless of whether the attempt succeeded or failed.
- Local admission failures do not emit provider usage because no provider request was dispatched.
- The execution checkpoint and assistant message retain partial coverage and its safe reason code;
  they do not retain provider bodies, prompts, document excerpts or stack traces.
- No pricing rule, point conversion, reservation policy or canonical grant owner changes.

## Failure behavior

- Model-call completion telemetry is persisted before emitting the standardized usage event.
- If the usage observer itself rejects, execution stops with
  `persistence.usage_event_failed`; the completed provider call is never retried implicitly.
- In the current `meter_only` integration, the shared integration may intentionally log and absorb
  a sink failure according to the billing rollout policy. The durable model-call row remains the
  reconciliation source with factual usage and request identity.

## Compatibility and rollout

- No database migration is required. Existing model-call usage fields and usage-event idempotency
  keys are reused.
- The usage observer receives a new `outcome` field. Existing consumers that select only billing
  fields remain compatible.
- Production deployment still requires migration 076 from the resumable-execution change.

## Verification

- Offline tests cover successful usage, provider-failed usage, local pre-dispatch rejection,
  observer failure, partial-delivery aggregate usage and idempotent event identity.
- Type checking, Grant architecture checks and the full Grant CI suite are required.
- A real paid-provider verification is intentionally excluded until separately authorized.
