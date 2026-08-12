# Impact Analysis 0022: Frozen V6 input and Fact Map assembly

## Problem and Evidence

- Semantic Review V6 needs one descriptive Fact Map before scientific and
  narrative diagnosis, but a second document parser or alias builder would
  create competing location authorities.
- Models must not mint canonical IDs, copy UUIDs or decide durable identity.
- A Fact Map must describe explicit semantic objects without prematurely
  diagnosing, ranking or recommending changes.

## Ownership

- Grant Model Data Gateway remains the sole owner of admitted text, Evidence
  Cards, figures and execution-local `N*` location aliases.
- The versioned Semantic Checker Contract owns semantic-object recognition.
- Fact Map Assembler owns `S*` allocation, canonical location resolution,
  revision binding, anchor ranges and hashes.
- Diagnostic Assembler continues to own cross-run continuity.

## Implemented Scope

- Adapt the already-authorized V5 prepared package into one frozen V6 Fact Map
  request and one future review base without rereading storage or authorization.
- Define a strict descriptive provider result containing only object type,
  normalized facet and supplied `N*` locations.
- Add a program-owned assembler that validates every location, allocates `S*`,
  resolves canonical IDs and hashes the exact frozen node text.
- Add a bounded descriptive prompt and contract regressions.

## No Parallel Authority

No production operation, model call, retry, route, repository, table, UI or
rollout selector is added. Active Semantic V5 remains unchanged. The V6 adapter
reuses the exact location, Evidence Card and figure maps already prepared by
the existing gateway path.

## Risks and Controls

- Alias drift: V6 reuses the existing location maps and scope fingerprint.
- Model-created identity: provider output has no semantic-object or canonical
  ID; the assembler assigns `S*` deterministically.
- Premature diagnosis: strict output rejects extra diagnostic fields.
- Fabricated location: every `N*` must resolve in the frozen map.
- Empty or oversized output: empty anchors and more than 256 objects fail.

## Rollback

Remove the additive target contracts, adapter, assembler, tests and documents.
There is no migration or production data to undo.

## Verification

- Strict Structured Output compatibility passes.
- Provider payload contains no canonical section/node IDs or Evidence Cards.
- V6 reuses the existing location and authorization sets.
- Legal objects resolve to canonical anchors and program-computed hashes.
- Unknown and duplicate location aliases fail with bounded structural issues.

