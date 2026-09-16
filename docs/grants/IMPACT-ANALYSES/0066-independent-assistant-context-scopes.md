# Impact analysis: Independent Grant Assistant context scopes

## Problem and Evidence

- A whole-document request is represented by `full_original` plus the same
  section and memory-item target arrays used for memory projection and relevant
  diagnostic filtering.
- The provider schema caps those arrays while a real document can contain more
  semantic items. A model can therefore select `full_original` correctly and
  still fail `planner.unavailable_target` by unnecessarily enumerating targets.
- The synthesis contract permits substantially more prose and claims than its
  completion budget can reliably return, increasing truncation risk.

## Ownership

- The semantic planner continues to propose semantic scope.
- The Context Planner remains the sole validator and resolver of proposed
  aliases to current Revision identities.
- The Planned Context Assembler remains the sole resolver of original text and
  current diagnostic Findings.
- The operation policy remains the sole owner of model token limits.

## Scope

- Replace the coupled planning fields with three independent, discriminated
  scopes: memory, original document and diagnostics.
- A whole-Revision original scope contains no model-enumerated targets; the
  program derives complete coverage from the canonical Revision.
- Targeted scopes remain fail-closed and accept only aliases supplied to the
  planner.
- Bound synthesis response shape and completion policy consistently.
- No database migration, new route, provider or authorization path is added.

## Options

- Chosen: version the in-process plan contract and update its sole assembler
  and execution consumers together.
- Rejected: silently discard invalid aliases for full-document plans. The same
  aliases can still be meaningful diagnostic targets, so this can broaden or
  narrow context incorrectly.
- Rejected: increase token limits without changing the response contract.
- The old coupled target fields are removed from the active contract; there is
  no parallel runtime path.

## Migration and Rollback

- The plan is rebuilt per turn and is not a durable canonical record, so there
  is no stored-data migration.
- Existing document memories remain readable; their contract is unchanged.
- Rollback is a code rollback before persisted execution checkpoints are added
  in the next delivery step.

## Verification

- Whole-Revision original access succeeds without target enumeration.
- Whole-Revision original access plus targeted diagnostics preserves strict
  diagnostic filtering.
- Invalid targeted memory, original or diagnostic aliases fail closed.
- Targeted original access still includes canonical descendant sections.
- Full-document synthesis request and schema use the policy-owned bounded
  output contract.
- Grant architecture check and TypeScript check must pass.
- No paid provider call is required for this step.
