# ADR 0067: persist and resume Grant Assistant composite executions

## Status

Accepted for implementation; database migration and production deployment require separate
authorization.

## Decision

Use one durable execution record per `(document_id, turn_id)`. Bind it to the current Revision,
canonical input hash, model and policy. Persist the validated semantic plan and each validated
full-review unit behind an expiring lease and compare-and-swap version.

The memory-planned assistant path receives one outer `GrantModelExecutor` attempt. Recoverable
planner, answer, unit or synthesis failures are retried only by the stage that owns the failed
request. Completed stages are reused, not rerun. A checkpoint is admissible only when its plan,
context hash, question hash and deterministic unit hash still match.

## Consequences

- A synthesis failure can no longer trigger another memory build or semantic plan.
- Refresh/retry can continue from validated work after a failed lease is reclaimed.
- Duplicate active submissions are rejected by the execution claim, while failed executions are
  resumable.
- Checkpoints become content-bearing data and must follow grant-document owner isolation and
  retention requirements.
- Provider usage from resumed stages is not counted again; only newly dispatched calls contribute
  to the new attempt's usage.

## Rejected alternatives

- Increasing token limits: moves the failure and does not prevent replay.
- Retrying the whole assistant lambda: duplicates paid stages and changes failure attribution.
- Reusing units by ordinal alone: unsafe when the Revision, question or routing changes.
- Adding a second background orchestration path: violates the single-owner invariant.
