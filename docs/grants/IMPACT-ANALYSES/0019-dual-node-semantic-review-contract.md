# Impact Analysis 0019: Dual-node semantic review identity

## Problem and Evidence

- Canonical Grant nodes are program-owned physical document structure. The next
  diagnostic-quality upgrade also needs model-recognized scientific questions,
  innovation claims, objectives, mechanisms, metrics and preliminary evidence.
- Those semantic objects are interpretations, not deterministic DOCX nodes.
  Treating them as canonical nodes would create a second document identity
  authority and make cross-run continuity depend on model segmentation.
- Existing ArgumentMap aliases are deliberately revision-bound and excluded
  from durable identity. The new contract must preserve that invariant while
  allowing later Fact Map coverage and calibration work.

## Ownership

- Grant Document Repository remains the only owner of canonical `sectionId` and
  `nodeId` values, hierarchy and order.
- Fact Map Builder may recognize revision-bound semantic objects, but it owns no
  canonical document identity.
- Diagnostic Assembler will later own semantic-object calibration using physical
  node overlap, anchored text similarity, object type and a normalized facet.
- Runtime checker selection, provider calls, persistence and UI remain unchanged
  in this contract-only step.

## Implemented Scope

- Reserve target-only Semantic Review V6 version relationships without changing
  the active V5 constants.
- Define a read-only diagnostic projection of an existing canonical physical
  node; its `nodeId` is the existing Grant node identity, not a new ID.
- Define revision-bound semantic objects with execution-local `S*` references,
  canonical source anchors, bounded text ranges and anchor hashes.
- Define wording-free cross-run continuity input and a program-owned four-state
  calibration result: `same`, `likely_same`, `ambiguous`, or `different`.
- Add contract tests that reject canonical IDs on semantic objects, cross-
  revision anchors, duplicate anchors, semantic aliases and free model prose in
  continuity identity.

## No Parallel Authority

The target contracts are additive and are not imported by production
composition. They do not add a route, button, model call, checker, repository,
document node type or persistence table. Later steps must extend the existing
semantic checker and Diagnostic Assembler or replace an owner through a new
authorized impact analysis.

## Versions

| Concern | Target-only value |
| --- | --- |
| Existing canonical document | `grant-canonical-v1` |
| Semantic object schema | `grant-semantic-object-v1` |
| Provider schema/run contract | `grant-semantic-diagnostic-v6` |
| Scientific Finding content | `grant-scientific-finding-v1` |
| Narrative Finding content | `grant-narrative-finding-v1` |
| Prompt | `grant-semantic-review-v6` |
| Execution policy | `grant-ai-policy-v5` |
| Checker | `6.0.0` |

These values reserve coordinated target contracts only. Active Semantic V5
continues to use its current version authority and canary selection.

## Risks and Controls

- Second node model: prevented by describing the physical-node contract as a
  read-only projection of existing `GrantNode.nodeId`.
- False semantic stability: `semanticObjectRef` is explicitly execution-local
  and rejected from continuity identity.
- Cross-revision identity errors: semantic anchors must match the object's
  frozen revision; calibration records use distinct revisions.
- Prose-based identity: continuity accepts only object type, normalized facet,
  physical node IDs and anchor hashes.
- Silent production change: tests assert the active V5 contract and checker
  values remain unchanged.

## Rollback

Remove the target-only contract, verifier and documentation. There is no data,
runtime, flag, provider, migration or user-visible rollback.

## Verification

- Valid physical-node projections and semantic objects parse.
- Invalid ranges, cross-revision anchors and duplicate anchors fail.
- Semantic objects reject `canonicalNodeId`.
- Continuity identity rejects `semanticObjectRef` and model prose.
- V6 provider schema and run contract target values advance together.
- Active V5 provider contract and checker version remain unchanged.
- Grant architecture, diagnostics, encoding and TypeScript checks pass.
