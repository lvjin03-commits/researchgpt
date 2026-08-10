# Impact Analysis 0016: Atomic Diagnostic Location References

## Problem and Evidence

- Production run `5c3c56ad-c714-42a4-93aa-61cb44e3f849` completed the GPT
  response with `finishReason=stop`, but four returned section/node pairs were
  outside the supplied reference scope.
- The run was `full_document` and covered 21 sections and 192 nodes, so input
  clipping did not cause the failure.
- The provider contract required the model to emit `sectionId` and `nodeId`
  independently. Even two individually plausible values can form a pair that
  is not a canonical node location.
- One invalid related location rejected the entire semantic execution. This is
  broader than the damaged field and discards otherwise usable Findings.

## Ownership

- Canonical section/node identity remains owned by Grant Document Model.
- Grant Model Data Gateway freezes one deterministic `locationRef` map per
  diagnostic execution. Provider retries reuse the same prepared input.
- The semantic model selects only supplied atomic references and never combines
  section and node identities.
- The existing semantic contract/normalizer resolves references and applies
  deterministic field-level degradation. Diagnostic Assembler still owns
  durable Finding IDs, locations, ordering and fingerprints.
- PostgreSQL continues to store canonical UUID locations in Finding V3.

## Scope

- Change provider input nodes from independent section/node IDs to one atomic
  location reference (`N1`, `N2`, ...).
- Change provider output locations to one `locationRef` field.
- Resolve references before the program-validation and assembler boundaries.
- Drop a Finding with an invalid primary reference. Remove an invalid related
  reference; if a cross-section Finding then has no related location, drop that
  Finding. An invalid Evidence Card reference also drops only its Finding.
- Keep closed-set validation after mapping and record only content-free
  normalization paths/rules.
- Deterministic checkers, the one diagnostic route/button, canonical revisions,
  UI projection, Evidence authorization, chat and Document V2 remain unchanged.

## Options

- Chosen: one indivisible reference per canonical node and deterministic mapping
  back to the existing durable location.
- Rejected: shorten section and node IDs independently; it preserves the invalid
  combination failure mode.
- Rejected: add another model retry; the observed failure was systematic and a
  second paid call cannot make independent ID composition authoritative.
- Rejected: discard the entire run for one bad related location; the failure
  boundary is wider than the damaged field.
- No parallel authority is introduced. The existing V3 gateway, executor,
  contract and assembler are updated in place.

## Migration and Rollback

- Provider/run contract advances to `grant-semantic-diagnostic-v4`; prompt to
  `grant-semantic-review-v4`; execution policy to `grant-ai-policy-v3.2`; checker
  logic to `4.0.0`.
- Durable Finding schema remains `grant-semantic-finding-v3` because stored
  fields and meanings do not change.
- Migration 046 keeps the existing save RPC and temporarily accepts both V3 and
  V4 run contracts. V3 compatibility may be removed after 30 days of successful
  V4 production runs and rollback-window observation, no earlier than
  2026-09-10.
- The existing semantic diagnostic feature flag remains the rollback switch.
  Turning it off prevents new semantic writes without affecting historical V2,
  V3 or V4 runs.

## Verification

- Contract tests prove one atomic reference maps to one section/node pair and
  mappings are stable for one prepared input and its retry.
- Executor tests prove invalid related references no longer discard a valid
  Finding, invalid primary references discard only their Finding, and an all-
  invalid response remains an explicit semantic failure without a paid retry.
- Existing assembler, persistence, rollout, architecture and UI tests pass.
- A real signed-in diagnostic run is required after migration/deployment; code
  and fixture tests alone are not effect-first completion.
