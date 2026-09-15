# ADR 0062: Layered Revision-bound document memory

- Status: accepted, Step 2 implemented locally; production rollout pending
- Date: 2026-09-15
- Owners: Grant Document Memory Builder and Planned Context Assembler
- Supersedes: flat `grant-document-memory-v1` runtime projection

## Context

The first memory contract stored a whole-document overview, every section
summary, every semantic item and every canonical node reference in one flat
object. Both semantic planning and answer generation replayed that whole object.
The memory was complete and Revision-bound, but its flat projection made exact
original references part of planning input and repeated unrelated semantic
content in narrow answers.

## Decision

The active memory contract is `grant-document-memory-v2` with three explicit
layers. L0 is compact whole-document cognition and a typed index of model-owned
semantic items. L1 contains section summaries and semantic memory without
canonical text. L2 contains only program-resolved canonical node references;
it stores no original text.

Semantic planning receives one compact L0+L1 index and never receives L2 node
IDs. Answer assembly always receives L0 plus the L1 material admitted by the
semantic plan. Exact original text is read from the current canonical Revision
only when the plan admits targeted or complete original access, using L2 anchors
as references and validating every anchor against the current snapshot.

There is one active contract and one pipeline. A new memory policy version
forces one rebuild per current Revision. Old v1 database rows remain auditable
but cannot be returned under the new policy or parsed as active runtime memory.

## Consequences

- Narrow questions no longer replay unrelated semantic items.
- Planning payloads cannot leak or spend tokens on UUID-level original anchors.
- Canonical content remains the only owner of exact text; memory remains derived
  and rebuildable.
- Migration 074 permits v1 rows and writes only for rolling-deployment
  compatibility; schema marker 074 activates the single v2 runtime path.
- Runtime activation requires schema marker 074.

## Verification

- Offline tests prove complete L1/L2 coverage, typed L0 indexing, no L2 IDs in
  planner input, selective L1 answer projection and current-Revision L2 reads.
- `npm run typecheck` and `npm run check:grant-architecture` must pass.
- Production migration, deployment and paid-provider verification require
  separate authorization.
