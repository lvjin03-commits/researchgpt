# Impact Analysis 0025: Semantic Review V6 unified execution

## Problem and evidence

- Fact Map, Scientific Review and Narrative Review are three paid operations,
  but independent retries or token defaults would create competing budget
  authorities.
- Fact Map did not yet have its own one-attempt provider adapter, so an
  aggregate counter could otherwise omit the first paid call.
- Recovery must reuse completed semantic work without crossing the frozen
  revision, location scope or image authorization boundary.

## Ownership

- Semantic Review V6 Executor owns the total provider-call and completion-token
  budget for all three operations.
- Each stage adapter owns one paid attempt and stage-specific validation only.
- Grant Model Data Gateway remains the only current image-admission authority.
- Persistence, rollout and UI remain later owners.

## Implemented scope

- Add a one-attempt Fact Map provider adapter.
- Execute Fact Map, Scientific Review and Narrative Review in order against one
  frozen prepared input.
- Fix the normal path at three calls and the exceptional ceiling at four.
- Permit one aggregate recovery only for truncation or explicitly transient
  provider failure. Deterministic reference, evidence, image, coverage and
  contract failures are not retried.
- Expose revision-bound Fact Map and Scientific Review checkpoints so later
  persistence can resume without repeating successful paid stages.

## No parallel authority

No route, worker, repository, migration, feature flag, UI or production model
selection is added. Stage adapters have no private retry loop or default
completion budget.

## Rollback

Remove the additive V6 aggregate executor, Fact Map adapter, tests and this
governance record. No production or user data changes require rollback.
