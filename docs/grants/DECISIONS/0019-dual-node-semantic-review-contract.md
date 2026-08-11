# ADR-0019: Separate canonical document nodes from semantic review objects

## Status

Accepted as a target-only contract. It does not change active production
diagnosis.

## Context

The next diagnosis-quality phase must recognize scientific questions,
innovation claims, objectives, mechanisms, metrics and preliminary evidence.
Their boundaries require interpretation and can vary between model runs. They
therefore cannot share the stability claim of program-parsed sections,
paragraphs, tables, figures and captions.

## Decision

1. Existing `GrantNode.nodeId` remains the only canonical physical-node
   identity. Diagnostic code may project it with revision, section, order and
   content hash, but may not create another canonical ID.
2. A recognized semantic object receives an execution-local `semanticObjectRef`
   and one or more ranges anchored to canonical physical nodes. It is diagnostic
   scaffolding, not a canonical document node.
3. Cross-run continuity never compares `semanticObjectRef`. A later program-
   owned calibrator considers physical node overlap, anchored text similarity,
   semantic object type and normalized facet.
4. Calibration is four-state. An uncertain match is `ambiguous`; it is never
   silently treated as the same object or as a new object.
5. Target V6 versions are reserved together, but active V5 constants, rollout,
   model calls, persistence and UI remain unchanged until later authorized
   steps.

## Consequences

- Fact Map variation cannot become a second document identity authority.
- Later coverage reports can refer to semantic objects within a frozen run while
  durable Findings remain anchored to canonical physical nodes.
- Cross-revision semantic calibration requires a later deterministic service
  and real regression data; this ADR defines its inputs and states but does not
  pretend that stable semantic segmentation is already solved.
- No migration or compatibility reader is required in this step.
