# ADR-0022: Keep Fact Map identity and anchors program-owned

## Status

Accepted as target-only Semantic Review V6 infrastructure. Production diagnosis
remains on the existing rollout selection.

## Context

The model can recognize scientific questions, innovation claims, objectives,
routes, mechanisms, metrics and preliminary evidence. It cannot reliably or
legitimately create canonical document identity, copy UUIDs, bind revisions or
decide cross-run continuity.

## Decision

1. Fact Map input reuses the existing Model Data Gateway `N*` aliases and
   location-scope fingerprint; it never rebuilds them.
2. Provider output contains only semantic type, normalized facet and supplied
   `N*` locations. It has no diagnosis, Finding, severity or recommendation.
3. Fact Map Assembler allocates execution-local `S*` references in frozen
   provider order and resolves all canonical IDs.
4. V1 anchors cover the complete selected canonical node. The program derives
   offsets and hashes from frozen node text; the model does not estimate them.
5. `S*` and model wording never participate in durable continuity.

## Consequences

- The model does less brittle ID copying and cannot impersonate a Grant node.
- Fact Map construction is deterministic after semantic recognition.
- Sub-node anchor refinement requires a future versioned contract change.
- Later review stages must consume this Fact Map, not create another identity.

