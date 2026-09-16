# ADR 0065: Rule-level Grant Assistant failure attribution

- Status: accepted, Steps 1–4 implemented; production migration applied,
  application deployment verification pending
- Date: 2026-09-16
- Owners: Grant Model Executor and the detecting Grant Assistant component
- Extends: ADR 0064 stage-aware Grant Assistant failures

## Context

The current telemetry can distinguish semantic planning from answer generation
and local contract failure from provider outage. It still cannot identify which
specific rule failed. Multiple validations therefore collapse into
`internal_contract_error`, and a historical trace cannot distinguish a missing
planner target from a stale memory anchor or an invalid grounded citation.

Persisting raw exception messages would improve debugging but would create an
unstable contract and risk leaking grant text, prompts, provider bodies or stack
details. Creating a separate error table or logger would also split authority
from the existing Model Executor attempt record.

## Decision

Every attributable Grant Assistant failure uses a versioned stable reason code.
One registry maps that code to its owning component, broad failure category and
legal execution stages. The detecting component selects the reason code; the
current pipeline supplies the stage; downstream modules may not reinterpret
either mapping.

Optional rule facts use a strict allowlist of numeric and boolean fields. Raw
messages remain internal and are never the durable reason contract. Provider
IDs, usage, dispatch state and hashes continue to use their existing dedicated
telemetry fields.

The contract extends the existing Model Executor path. Migration 075 adds
nullable reason version, code, component and safe-facts fields to the existing
`grant_model_calls` row. The existing finish RPC stores them atomically with
category, stage, dispatch state and usage. It does not create a parallel logger,
retry path, failure presenter or public error taxonomy.

## Consequences

- New traces can eventually identify an exact failed rule without storing
  document or model content.
- Historical traces without a rule code remain honestly unknown; they are not
  guessed or backfilled from broad categories.
- Retryability and user text remain controlled by the existing category/stage
  presenter.
- Adding or changing a reason code requires a contract change and offline test.
- Historical rows remain valid with no rule-level reason and are not backfilled.
- Detecting runtime components attach their reason before pipeline aggregation;
  unknown exceptions receive the explicit executor fallback code.

## Verification

Offline contract tests prove reason-code uniqueness, registry ownership,
stage/category consistency, rejection of free-form sensitive facts, in-memory
persistence, Supabase RPC parameter mapping, post-provider planner rejection,
context capacity rejection, hierarchical aggregation and provider attribution.
Migration 075 has source-level contract checks and was applied to production on
2026-09-16. A read-only schema probe confirmed the reason-code column, the
safe-facts validator and exactly one 20-argument finish RPC. The API returns the
safe rule diagnostic beside the trace ID, Vercel logs the same fields, and an
owner-scoped trace endpoint exposes only the safe attempt projection. Signed-in
application verification remains pending deployment; no paid-provider probe was
performed.
