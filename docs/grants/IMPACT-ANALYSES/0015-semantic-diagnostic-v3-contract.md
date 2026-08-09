# Impact Analysis 0015: Semantic Diagnostic V3 Contract

## Problem and Evidence

- The current semantic checker can report one of six semantic categories, but
  each model result is reduced to one message, one recommendation and one
  source node.
- That representation cannot preserve the observable diagnostic fact, the
  reasoning boundary, an optional concrete consequence, multiple related
  locations, or the exact authorized Evidence Cards used by the judgment.
- Replacing only the prompt would create a contract mismatch: the current
  strict Structured Output schema, assembler, persistence projection and UI
  cannot validate or render the proposed V3 result.

## Ownership

- Semantic issue content belongs to the versioned semantic checker contract.
- Current evidence admission and excerpt selection remain owned by Grant Model
  Data Gateway and Evidence Authorization Service.
- Finding IDs, lifecycle, stable identity, fingerprints and conflict records
  remain owned by Diagnostic Assembler and the diagnostic repository.
- Canonical section/node identity and reading order remain owned by the Grant
  Document Model. The model may reference only supplied IDs.
- Finding presentation may filter or group by actionability, but its default
  order is canonical section and node order; UI must not reinterpret
  actionability as severity or priority.

## Scope

- Contract-first documentation for a future V3 semantic result, strict-output
  schema, model input, assembler, persistence projection and issue-card view.
- Additive storage for related locations and V3 diagnostic content will be
  required in a later, separately authorized migration.
- Existing deterministic checkers, one-button diagnostic execution, revision
  service, patching, evidence authorization, chat and Document V2 remain
  unchanged.
- No provider call, database migration, feature-flag change or UI behavior is
  part of this contract-only step.

## Risks and Controls

- Strict Structured Output: nullable values remain required and use JSON null;
  arrays remain required and use an empty array. Optional schema properties are
  forbidden in the provider-facing V3 result.
- Category drift: overlapping categories require positive and negative examples
  in prompt fixtures and contract tests.
- Evidence overreach: `metadata_only` proves only that a record exists;
  scientific support requires a `verified` card and a matching supported scope.
- Duplicate missing-information findings: omissions concerning one semantic
  subject and one chapter are merged into one Finding.
- Fingerprint churn: recommendation wording and possible consequences are not
  part of stable identity.
- Historical compatibility: V2 records remain immutable audit data. A completed
  V3 run, not deployment alone, supersedes corresponding active V2 findings.

## Migration and Rollback

- V3 is introduced behind the existing Grant diagnostic capability, not as a
  parallel route or checker button.
- Readers receive one normalized view model. Presentation components do not
  branch on V2 versus V3 persistence shapes.
- No automatic provider call is made to migrate historical findings. The first
  user-requested V3 run for a revision creates V3 findings and supersedes the
  applicable V2 active projection while retaining V2 audit records.
- Before V3 activation, rollback is documentation-only. After implementation,
  rollback must keep V2/V3 historical records readable and turn off V3 writes.

## Verification Required Before Activation

- Strict-schema compatibility, including required-nullable and required-array
  behavior.
- Category boundary fixtures and duplicate-merging fixtures.
- Supplied-node and authorized-evidence ID rejection tests.
- Stable fingerprint and incremental-recheck compatibility tests.
- Canonical-order UI tests proving actionability does not affect default order.
- A real signed-in diagnostic run on an anonymized application, including a
  cross-section finding with more than one location.

