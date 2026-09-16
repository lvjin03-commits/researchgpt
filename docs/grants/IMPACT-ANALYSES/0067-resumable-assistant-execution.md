# Impact analysis 0067: resumable Grant Assistant execution

## Problem

`GrantModelExecutor` treated one assistant turn as one retryable provider call even though the
memory-planned path contains document-memory construction, semantic planning, original retrieval,
unit analysis and synthesis. A terminal synthesis failure therefore restarted earlier paid stages.
The restarted planner could fail for a different reason, hiding the original failure and discarding
usable unit results.

## Authority and boundary changes

- `GrantAssistantChatService` claims one Revision-, input-, policy- and model-bound execution.
- `GrantAssistantMemoryPipeline` remains the sole orchestration owner and persists its frozen plan.
- The hierarchical-review executor persists each validated unit result and reuses only units whose
  deterministic unit hash matches the current document context and question.
- `GrantModelExecutor` remains the model-call ledger owner, but the composite memory-planned path
  is configured for one outer attempt. Stage-local code owns its single recovery decision.
- The canonical grant Revision, diagnostics, evidence authorization and formal-content write owners
  do not change.

## Data and security

Migration 076 adds an owner-isolated, service-role-only execution table. Checkpoints may contain
model-derived document summaries, so direct authenticated/anonymous access is denied. RPCs verify
ownership through `grant_documents`. Claims use leases and saves use optimistic version checks.

## Compatibility and rollout

- Existing sessions and model-call records are unchanged.
- Existing failed turns have no checkpoint and start a fresh execution once; new executions can
  resume saved stages.
- Migration 076 must be applied before deploying the application code.
- No background worker or parallel assistant route is introduced.

## Verification

- Offline tests cover stage-local recovery and reuse of saved units.
- Type checking, Grant architecture checks and the full Grant CI suite are required.
- Production paid-provider verification remains a separate explicitly authorized step.
