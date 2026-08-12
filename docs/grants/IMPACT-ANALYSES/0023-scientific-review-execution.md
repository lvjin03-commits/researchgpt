# Impact Analysis 0023: Scientific Review V6 execution

## Problem and Evidence

- Fact Map objects require scientific review that first accounts for existing
  design and then reports only a remaining gap.
- A Finding-only response cannot prove that every innovation, question,
  objective, route, evidence item and metric was actually reviewed.
- Provider references and evidence claims remain untrusted even under strict
  Structured Outputs.

## Ownership

- Versioned Semantic Checker Contract owns scientific interpretation and the
  residual-gap conclusion.
- Grant Model Data Gateway owns the frozen text, Evidence Card admission and
  `N*` location scope.
- Scientific Review Assembler owns reference resolution, evidence-scope checks
  and deterministic normalization of related locations.
- Fact Map Coverage Assembler remains the only completeness authority.
- A later aggregate V6 orchestrator owns call and token budgets and any retry.

## Implemented Scope

- Build Scientific Review input from one frozen V6 prepared package and mature
  Fact Map without exposing canonical IDs.
- Add verify-before-report system instructions and strict combined provider
  output for Scientific Findings plus Fact Map coverage dispositions.
- Resolve Finding locations, existing-design locations, semantic-object refs
  and Evidence Card IDs through program-owned scopes.
- Reject metadata-only scientific support, orphan Findings and incomplete Fact
  Map coverage.
- Add a one-attempt OpenAI adapter with safe structural telemetry and no
  persistence or private retry counter.

## No Parallel Authority

This is target-only V6 infrastructure behind the existing Grant model adapter
boundary. It adds no route, button, checker registration, repository, table,
rollout selector or UI. Active Semantic V5 remains unchanged.

## Risks and Controls

- Forced Findings: every Fact Map object may be marked verified with no gap;
  zero Findings is valid only with complete coverage.
- Partial-design erasure: each residual-gap Finding carries bounded existing
  design and its evidence tier.
- Evidence overclaim: authorized scientific support requires a currently
  admitted `verified` card; metadata-only cards cannot support conclusions.
- Reference fabrication: primary and existing-design locations are mandatory;
  invalid related locations degrade locally.
- Cost growth: the executor performs one call only and requires its completion
  budget from the later aggregate owner.

## Rollback

Remove the additive V6 execution files, tests and documents. No migration,
production state or user data changes require rollback.

## Verification

- Scientific input exposes only frozen `S*` and `N*` aliases.
- Fully covered objects can publish no Finding.
- Incomplete coverage, invalid existing design and metadata overclaim fail.
- Invalid related locations degrade without changing scientific content.
- Executor performs exactly one call and distinguishes truncation.

