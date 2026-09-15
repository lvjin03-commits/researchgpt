# ADR 0064: Stage-aware Grant Assistant failures

- Status: accepted, Step 4 implemented locally; production verification pending
- Date: 2026-09-15
- Owners: Grant Model Executor and Grant Model Failure Presenter

## Context

Capacity rejection, truncated output, invalid structured results and genuine
provider outages were historically liable to reach the user as the same
“service unavailable” message. In hierarchical review, a later unit failure
could also omit the request IDs and usage of earlier successful units from the
error propagated to the aggregate executor.

## Decision

Every Grant Assistant failure retains a program-owned category and one of the
existing execution stages: memory build, semantic planning, context admission,
original retrieval, answer generation or persistence. The Model Executor stores
category, stage, dispatch state, usage-known state, all provider request IDs and
aggregate usage. Hierarchical review accumulates prior successful unit metadata
before propagating a later provider or validation failure.

One pure failure presenter maps category plus stage to HTTP status, retryability
and user-facing Chinese text. API routes do not recreate that mapping. The
client displays the returned message and trace ID. Capacity and local contract
failures are never described as provider outages.

## Consequences

- Pre-dispatch capacity rejection is auditable with zero usage and
  `requestDispatched=false`.
- Provider failures retain factual request IDs and known usage.
- Truncation text identifies whether memory, planning or answering failed.
- Users receive a trace ID without receiving prompts, excerpts or provider
  secrets.
- Existing migration 073 already contains the required metadata columns; this
  step adds no migration.

## Verification

Offline tests cover presentation mapping, pre-dispatch capacity telemetry,
multi-unit partial-failure aggregation, API wiring and client trace display.
Full Grant CI, type checking, lint and architecture checks must pass. A signed-in
production path and paid-provider failure probe require separate authorization.
