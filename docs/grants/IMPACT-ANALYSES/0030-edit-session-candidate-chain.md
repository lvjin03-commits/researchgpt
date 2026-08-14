# Impact Analysis 0030: Edit Session Candidate Chain

## Outcome

Introduce a persisted multi-turn editing workspace whose candidates remain proposals. No candidate can write the canonical grant document in this step.

## Owners and boundaries

- `GrantAiEditSessionService` owns session, turn and candidate lifecycle.
- `GrantModelDataGateway` remains the only model-context/provider boundary.
- `GrantModelExecutor` remains the call budget, retry and observability owner.
- `GrantRevisionService` remains the only canonical write owner; this step never calls its commit operation.

`basedOnCandidateId` records the visible conversation parent. `semanticBaseCandidateId` records the safe candidate text actually sent to the model. A blocked candidate may remain the visible parent but cannot become the semantic base.

## Concurrency

The session freezes a source revision and target-node text hash. Every turn rechecks both. A mismatch passively marks the session stale before any provider call. This is intentionally passive; no revision event listener is introduced.

## Scope and rollback

Step 2 supports text-only candidate iteration and recovery. Evidence, figures, web sources, deterministic claim bindings, HTTP/UI exposure and canonical application are later steps. Rollback consists of disabling future composition and retaining proposal history; canonical content is unaffected.

