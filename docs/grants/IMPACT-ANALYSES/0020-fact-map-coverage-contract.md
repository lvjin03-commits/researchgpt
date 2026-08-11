# Impact Analysis 0020: Fact Map coverage contract

## Problem and Evidence

- A missing Finding does not prove that a semantic object was reviewed or that
  no residual gap exists.
- `residualGap` and other model prose cannot be used by the program to infer
  review completeness.
- Innovation claims, scientific questions and the remaining Semantic Review V6
  object types require an explicit, machine-checkable disposition.

## Ownership

- The versioned Semantic Checker Contract owns the semantic review disposition:
  residual gap found, verified with no residual gap, or unable to verify.
- The Fact Map Coverage Assembler owns completeness, reference and binding
  validation. It does not reinterpret scientific judgment.
- Canonical document identity remains owned by Grant Document Repository;
  coverage uses execution-local semantic references only within one frozen run.
- Finding identity and cross-run continuity remain owned by Diagnostic
  Assembler and do not depend on coverage wording.

## Implemented Scope

- Reserve target-only schema `grant-fact-map-coverage-v1`.
- Define a strict Structured Outputs provider contract with all fields required.
- Define three explicit dispositions and bounded unable-to-verify reasons.
- Add a pure program-owned assembler that requires every frozen semantic object
  exactly once, validates object type, validates Finding references and rejects
  orphan Findings.
- Enforce that no-gap and unable-to-verify objects publish no Finding, while a
  residual-gap object binds at least one valid Finding.

## No Parallel Authority

This step extends the existing target-only Semantic Review V6 contract. It adds
no route, provider call, checker, repository, table, feature flag or UI state.
The active Semantic V5 path remains unchanged.

## Risks and Controls

- False completeness: prevented by exact expected-object coverage checks.
- Model-created references: provider strings are resolved against frozen `S*`
  and `F*` sets by the assembler.
- Forced weak Findings: verified-no-gap objects must not bind a Finding.
- Hidden omissions: all valid Findings must be bound to at least one semantic
  object; orphan Findings fail the quality gate.
- Authorization loss misread as resolution: unable-to-verify is explicit and
  carries a bounded reason rather than becoming verified-no-gap.

## Rollback

Remove the additive coverage schemas, assembler, tests and documentation. No
data or production behavior requires rollback.

## Verification

- Provider schema compiles as strict Structured Outputs.
- Complete three-state coverage succeeds.
- Missing, duplicate, unknown and type-mismatched semantic-object coverage is
  rejected.
- No-gap objects cannot publish Findings; residual gaps require Findings.
- Orphan and unknown Finding references are rejected.
- Active Semantic V5 versions and runtime selection remain unchanged.

