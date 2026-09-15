# ADR 0063: One memory-planned Grant Assistant execution pipeline

- Status: accepted, Step 3 implemented locally; production rollout pending
- Date: 2026-09-15
- Owners: Grant Assistant Memory Pipeline and Context Budget Planner
- Supersedes: `GrantModelDataGateway.answerFullDocumentAssistantChat`

## Context

The assistant had two execution paths. Ordinary and targeted questions used
Revision-bound document memory and semantic planning, while a separate gateway
method handled full-document questions. That method could send a small complete
document through one `answerChat` call, had its own admission behavior and
duplicated routing responsibility.

## Decision

All ordinary document conversation enters the existing memory-planned pipeline.
The validated semantic plan selects exactly one execution mode:

- `memory_discussion` uses L0/L1 memory;
- `targeted_original` adds only program-resolved current-Revision nodes;
- `hierarchical_full_review` reads every canonical section in bounded units,
  then performs one bounded synthesis.

`full_original` remains a semantic planning request, not permission to build a
single giant prompt. Planned context records complete deterministic coverage but
does not materialize every original node. The pipeline owns hierarchical
execution, uses operation-registry limits, admits the exact provider messages
through the single context-budget owner, and converts only actually cited
current-Revision nodes and Findings into the normal grounded-answer contract.

The old full-document gateway method is deleted. There is no single-pass
full-document assistant compatibility branch.

## Consequences

- Full review is based on complete canonical coverage without requiring the
  whole original to fit one request.
- Ordinary discussion and targeted verification retain their cheaper paths.
- Current normalized diagnostics can participate in synthesis as separately
  typed sources; they are never relabeled as original text.
- Unit and synthesis output limits are operation policy, not adapter constants.
- Provider message construction is shared by budgeting and dispatch.

## Verification

Offline tests prove all three modes enter the same memory-planned pipeline, full
review never calls `answerChat`, every canonical section/node is covered, exact
unit/synthesis requests are admitted before dispatch, citations resolve to
current original nodes, and the former gateway entry point no longer exists.
Production deployment and paid-provider verification require separate user
authorization.
