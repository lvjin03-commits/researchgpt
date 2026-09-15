# Impact analysis: Grant Assistant context budget and execution telemetry

## Problem and Evidence

- Observed behavior: a long full-document conversation can fail before or after
  one of several model stages and surface as a generic provider outage.
- Reproduction evidence: the planner and answer adapter used different hidden
  limits; the executor persisted only one request ID and defaulted missing usage
  to zero.
- Root cause: context admission, output limits and failure accounting had
  multiple owners.
- Why this is not only a symptom: increasing any single limit leaves the other
  independent limits and lost intermediate usage unchanged.

## Ownership

- Current authoritative owner: fragmented between application functions and
  the OpenAI adapter.
- Owner after the change: the registered Operation Policy owns limits; the
  Context Budget Planner owns admission; the model executor owns audit state.
- Downstream consumers: Model Data Gateway, OpenAI adapter, API error mapper and
  Supabase model-call repository.
- Downstream modules must not recalculate capacity or relabel local capacity
  rejection as provider failure.

## Scope

- Change the existing assistant execution path only; add no route or parallel
  orchestration.
- Preserve current question and admitted grant sources before conversation
  history.
- Persist non-sensitive stage/request/usage certainty metadata via migration
  073.
- Do not change canonical grants, revisions, evidence authorization, patches,
  web budgets or billing authority.

## Options

- Chosen: shared provider request builders plus one deterministic context
  admission planner and aggregate pipeline failure metadata.
- Rejected: larger constants, catch-and-retry patches and silent source
  truncation.
- No parallel authority is created because old local admission calculations and
  adapter output constants are replaced.

## Migration and Rollback

- Runtime is gated on `GRANT_ASSISTANT_CHAT_DATABASE_SCHEMA=073`.
- Migration 073 replaces the old finish RPC signature and adds nullable or
  defaulted telemetry fields.
- Rollback may leave the new columns in place; they contain no sensitive text.

## Verification

- Contract: model execution, context planner, memory pipeline and fake OpenAI
  adapter tests.
- Architecture: `npm run check:grant-architecture`.
- Regression: long history cannot displace required document context; a later
  provider failure retains earlier request IDs and usage.
- Real user path: pending migration, deployment and separately authorized paid
  production verification.
