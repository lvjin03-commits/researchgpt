# Impact analysis: Layered Grant document memory

## Problem and Evidence

The flat v1 snapshot made a complete first reading reusable, but the planner and
answer assembler both consumed its entire projection. In a 21-section memory
with dozens of semantic items this duplicated unrelated content and mixed
semantic understanding with exact canonical references.

## Ownership

- The model continues to own summaries, semantic statements and their kinds.
- The Memory Builder owns stable IDs, L0 grouping, L1 assembly, L2 canonical
  reference resolution, coverage and hashes.
- The Context Planner owns only semantic access proposals.
- The Planned Context Assembler owns selective L1 projection and L2 resolution
  against the current canonical Revision.
- Canonical Revision, diagnostics, Evidence, billing and Patch authorities do
  not change.

## Scope and Compatibility

The existing memory contract is replaced, not supplemented. The active runtime
parses v2 only and uses a new policy version, so no flat-memory compatibility
branch enters planning or answer generation. Migration 074 retains v1 rows and
temporarily accepts v1 writes so pre-cutover instances do not fail between the
migration and schema-marker switch. The marker-074 runtime writes and parses v2
only; v1 write compatibility can be removed after the rollback window closes.

No original grant text is copied into L2. It contains node IDs only. Exact text
is always read from the current canonical snapshot after anchor validation.

## Risks and Controls

- Missing anchors: the v2 schema requires exactly one L2 anchor per L1 section
  and semantic item.
- Stale anchors: assembly validates node-to-section membership against the
  requested current Revision.
- Semantic loss: planning still receives every L1 section and semantic item;
  answer projection preserves L0 and admits relevant L1 material.
- Dual paths: the old flat runtime shape is deleted; only old stored rows remain.

## Rollout and Rollback

Apply migration 074 and set `GRANT_ASSISTANT_CHAT_DATABASE_SCHEMA=074` before
enabling the runtime. The first later turn rebuilds the current Revision memory
under the new policy. Rollback disables the assistant or returns the runtime and
schema marker to the prior version; retained derived memories do not affect
canonical documents.
