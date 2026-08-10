# Impact Analysis 0017: Hierarchical Semantic Diagnostic Contract

## Problem and Evidence

- The active semantic checker emits independent Findings directly from the full
  document. It can identify local issues, but it has no explicit representation
  of the application's research context, gap, scientific question, hypothesis,
  objectives, content, route, feasibility basis, innovation and contribution.
- A professional review needs to reconstruct that argument before grouping
  repeated sentence-level symptoms into root issues.
- Existing production incidents already established that models must not copy
  or combine canonical UUIDs. The active boundary therefore uses atomic
  execution-local references, which the hierarchical contract must preserve.
- ArgumentMap output is model-generated and may vary between runs. It cannot
  become a new cross-revision identity authority without breaking incremental
  recheck continuity.

## Ownership

- Canonical node identity and order remain owned by Grant Document Repository.
- Atomic provider references remain owned by Grant Model Data Gateway and are
  frozen per prepared execution.
- ArgumentMap is descriptive, revision-bound diagnostic scaffolding. It may be
  saved as a resumable checkpoint, but it does not own durable document or
  Finding identity.
- Semantic root-issue content remains owned by the one versioned semantic
  checker contract.
- Occurrence and root continuity remain owned by Diagnostic Assembler and are
  derived from canonical node identities, never ArgumentMap numbering or model
  prose.
- Aggregate diagnostic status remains the existing diagnostic execution
  authority. New stage states explain progress/failure and do not replace it.

## Implemented Scope

- Step 1 adds target-only schemas for descriptive ArgumentMap output, root Findings,
  canonical occurrence/root continuity identity and stage failure states.
- Step 1 freezes the identity rule: execution-local references and ArgumentMap wording
  cannot enter cross-run identity.
- Step 2 extracts the existing V4 atomic-location builder as the one shared
  authority and adapts one already-authorized prepared input into frozen Step A
  and Step B base requests. Both carry the same location-scope fingerprint and
  reuse the same canonical resolver maps.
- Step 2 adds deterministic ordering, caller-order invariance, revision binding,
  canonical-ID non-disclosure and existing-V4 compatibility tests.
- Step 3 adds the descriptive ArgumentMap prompt, strict Structured Output
  provider adapter, deterministic reference assembly and program validation.
  It performs one call only; retry and aggregate two-stage budget remain later
  policy work. No production composition invokes it yet.
- Step 4 adds the root-diagnosis prompt, strict provider adapter and bounded
  assembler. Repeated manifestations may remain under one root card, invalid
  related locations degrade locally, invalid primary occurrences are removed,
  and out-of-scope evidence cannot become a durable finding.
- Step 5 adds one aggregate call-budget owner: ArgumentMap has one call, root
  diagnosis has at most two calls and the entire operation has at most three.
  Root retry changes the failed condition and is limited to truncation,
  structured-output repair, 429 or explicit 5xx failures. Unknown outcomes,
  400s, reference failures and Evidence failures do not retry. A validated
  ArgumentMap checkpoint can resume Step B without regenerating Step A.

These steps do not change production composition, prompts, provider calls,
budgets, persistence, feature flags, database schemas or UI behavior.

## No Parallel Authority

The future implementation must replace the internals of the existing semantic
checker selected by the existing `AI诊断` action. It must reuse Grant Model Data
Gateway, Diagnostic Assembler, the durable Finding envelope, normalized read
projection and current evidence authorization. No second button, route, model
gateway, diagnostic repository or recheck mechanism is authorized.

## Versions

The accepted target versions are:

| Concern | Target |
| --- | --- |
| ArgumentMap provider schema | `grant-argument-map-v1` |
| Root diagnostic provider schema/run contract | `grant-semantic-diagnostic-v5` |
| Model instructions | `grant-semantic-review-v5` |
| Durable root Finding content | `grant-semantic-finding-v4` |
| Unified two-stage execution policy | `grant-ai-policy-v4` |
| Semantic checker logic | `5.0.0` |

Active V4 constants remain unchanged in this step. Later stages must update
their owning constants and database acceptance together; target constants in a
contract-only module are not production selection.

## Risks and Controls

- Identity drift: continuity accepts canonical node IDs only; execution-local
  references, map statements and diagnostic wording are rejected by strict
  identity schemas.
- Responsibility drift: ArgumentMap has no diagnosis, recommendation, severity
  or priority fields. The Step A prompt forbids evaluation and strict schemas
  reject additional diagnostic fields. Step B owns evaluation.
- Feature loss: the existing eight semantic categories remain available rather
  than collapsing innovation or research-design checks.
- Retry multiplication: Step 5 is the sole aggregate budget owner. Stage
  adapters contain no retry loops and cannot exceed the 1 + 2 call ceiling.
- Mapping drift: V4 and the target path call the same pure atomic-location
  builder. The target adapter consumes the existing prepared input and cannot
  remap locations or re-read evidence independently.
- Historical compatibility: current V2/V3/V4 records stay immutable and active
  production reads/writes remain unchanged.

## Rollback

All additions in this step are unused target contracts and documentation.
Rollback removes those additions. No data migration or user-visible rollback is
needed because runtime selection is unchanged.

## Verification

- Both future provider schemas compile to strict Structured Outputs schemas.
- ArgumentMap program validation requires every argument role exactly once.
- Step A rejects diagnostic fields.
- Root output rejects severity.
- Continuity schemas reject `locationRef` and diagnostic prose.
- Active production semantic version remains V4.
- Step A and Step B base inputs have the same location-scope fingerprint and
  resolve through the exact same prepared canonical maps.
- Reordering caller-supplied section/node IDs does not change the frozen scope.
- Provider input contains no canonical section/node UUIDs.
- ArgumentMap requires every role exactly once; missing roles, unsupported
  relations and out-of-scope atomic references fail with stage-specific codes.
- Step 3 makes exactly one provider call and never spends a hidden local retry.
- Step 4 preserves multi-occurrence root cards, rejects severity and external
  assertions, and makes exactly one provider call without a private retry.
- Step 5 proves the three-call ceiling, accumulated usage, failure-specific
  retry configuration, non-retryable failures and zero-cost checkpoint rejection.
- Grant architecture and TypeScript checks pass.

## Step 6 Implementation Boundary

- The existing Diagnostic Assembler remains the identity owner. It derives
  occurrence and root fingerprints entirely from canonical node relationships.
- The existing `grant_findings` table remains the durable envelope. Migration
  047 adds only V4 root content, occurrence details and ArgumentMap checkpoints.
- ArgumentMap checkpoints are revision/input/scope bound and consumed by the
  same atomic repository operation that saves a successful hierarchical run.
- The normalized read projection is extended below the UI. The right panel
  displays one root card and can navigate to each manifestation without
  inferring grouping or severity.
- The V5 provider path remains unselected; migration 047 is not applied by this
  implementation step.

## Step 7 Rollout Boundary

- The existing semantic checker, route and `AI诊断` action remain the only
  authorities. Cohort selection changes one internal implementation and never
  executes V4 and V5 in parallel.
- Admission fails closed unless server mode is `canary`/`on` and deployment
  explicitly declares migration 047 ready. Canary selection uses authenticated
  owner identity and cannot be controlled by request payload or browser state.
- Failure after Step A saves only a bounded checkpoint and a failed run. It does
  not publish Findings or report complete semantic coverage.
- Immediate rollback sets rollout mode `off`; no database rollback or canonical
  content mutation is required.
- Migration 047, canary activation and a real signed-in GPT run remain separate
  operational actions requiring authorization.
