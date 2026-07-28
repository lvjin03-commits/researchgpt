# Document v2 Orchestrator

This document describes the isolated orchestration kernel. It is authoritative
for step 3 of the document-v2 migration and must be updated when orchestration
states, retry boundaries, or component ownership change.

## Scope

The orchestrator:

1. accepts one validated `DocumentRequest`, immutable `DocumentPlan`, and pool
   of verified references;
2. executes plan components in their declared order;
3. asks an injected generator for one component draft at a time;
4. performs deterministic structural checks;
5. asks an injected validator for semantic acceptance;
6. retries only the current rejected component;
7. assigns stable block IDs after acceptance;
8. assembles one validated `FinalDocumentSpec`;
9. supports serialization, pausing, and resuming without regenerating approved
   components.

It does not select templates, call a model provider directly, render DOCX,
write files, store jobs, or route chat requests.

## State transitions

```text
pending
  -> running
      -> paused -> running
      -> completed
      -> failed
```

Each component transitions independently:

```text
pending -> running -> approved
                  \-> running (local retry)
                  \-> failed  (attempt limit reached)
```

Approved components are immutable during the remaining job. A resumed job
starts from `currentComponentIndex`; it cannot regenerate earlier approved
components.

## Ownership

| Value | Owner |
|---|---|
| Component order and keys | `DocumentPlan` |
| Semantic draft | injected `DocumentComponentGenerator` |
| Semantic acceptance | injected `DocumentComponentValidator` |
| Attempts and current index | orchestrator |
| Final block IDs | orchestrator |
| Verified reference pool | upstream literature or user-material service |
| Final content order | approved component order |

The generator never supplies component keys or final block IDs.

## Deterministic gates

Before semantic validation, the orchestrator rejects:

- a payload kind that does not match the planned component type;
- an abstract that is not exactly one abstract paragraph;
- a keywords component that is not exactly one keywords block;
- a conclusion without a conclusion paragraph;
- section output containing abstract or keywords content;
- malformed table rows;
- citations outside the verified reference pool;
- reference-list selections outside the verified reference pool;
- a reference list that omits a reference already cited by approved content.

These failures remain local to the current component and provide repair
feedback to its next attempt.

## Plan invariants

- Exactly one title exists and is the first component.
- Exactly one reference-list component exists and is the final component.
- Request and plan IDs match.
- Component keys are unique and execution-state order matches plan order.

Invalid plans are rejected before generation starts.

## Retry boundary

`maxAttemptsPerComponent` defaults to two. Generator exceptions, malformed
payloads, deterministic gate failures, and semantic rejections consume an
attempt. Reaching the limit fails the job with the current component key and
reason. The orchestrator never responds to a local failure by rewriting the
whole document.

## Implemented downstream in step 7

- durable-repository boundary and optimistic revision contract;
- time-limited worker lease;
- cooperative cancellation;
- checkpoint-based resume;
- public progress snapshots and structured stage events.

See `docs/document-v2-runtime.md`.

## Not yet implemented

- binding the structured generator and optional semantic reviewer to a
  production model provider;
- production persistent repository and distributed worker queue;
- wall-clock timeout;
- document planning from a resolved template blueprint;
- live UI progress streaming;
- production feature flag and chat-route integration.
