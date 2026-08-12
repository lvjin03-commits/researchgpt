# Grant Platform Implementation Plan

This plan is intentionally staged. A later phase must not be pulled forward by
adding a compatibility branch to an earlier phase.

## Preconditions

No user-facing implementation begins until the governance baseline is active
and the four technical spikes below have written results.

## PR0: Product Evidence

Use real, anonymized grant applications to validate diagnostic correctness,
source location, advice usefulness, and representative patch examples. This is
an evidence exercise, not a production-code milestone.

## Technical Spikes

1. DOCX round-trip: import, canonical nodes, no-op export, structural comparison.
2. Anchor drift: insert/delete/split/merge/move/rename/paraphrase/table changes.
3. Patch concurrency: user edits during generation; stale patch cannot overwrite.
4. Authorization propagation: revoke evidence; queued calls, caches, and draft
   patches stop using it.

Each spike must record fixtures, measurements, failure modes, and the resulting
contract decision under `docs/grants/DECISIONS/`.

Execution status (2026-08-07): all four isolated spike suites completed. The
measured results are recorded in `docs/grants/spikes/README.md` and ADR-0004
through ADR-0007. DOCX structural verification completed, but page-render
fidelity remains unverified because no usable renderer was available in the
non-interactive environment; that limitation remains an import/export exit gate.

## Delivery Sequence

| Phase | Deliverable | Exit condition |
|---|---|---|
| PR1 | Canonical node model, revision service, template snapshot, base audit | Atomic compare-and-swap and recovery tests pass |
| PR2 | Structured editor, explicit user save, revision recovery, length estimate | Reload and concurrent-edit scenarios preserve committed content |
| PR3 | Checker execution, Finding/conflict contracts, cross-version anchors | Every Finding is traceable or explicitly unlocated |
| PR4 | Three-pane UI, collapsed issue cards, bidirectional navigation, feedback | Real source-to-Finding navigation verified |
| PR4.5 | Existing DOCX preview and confirmed initial-revision import | A real DOCX is parsed, warnings are shown, and only confirmation creates canonical content |
| PR5 | Evidence-free AI Patch, diff, acceptance, audit | Patch cannot exceed target or overwrite stale revision |
| PR6 | Project resources, Evidence Cards, authorization, deletion | Revocation propagation verified end to end |
| PR7 | Evidence-backed Patch, citation control, evidence safety | Every use maps to an authorized evidence excerpt |
| PR8 | Incremental recheck, convergence control, real DOCX render/export | Real file opens, layout is inspected, recheck is stable |

PR1 implementation status (2026-08-07): canonical node contracts, Revision
Service, immutable template/revision/audit records, owner-scoped Supabase RPC
adapter, additive migrations, and concurrency contract tests are implemented.
Migrations 032 through 034 have been applied to production, and the real
PostgreSQL compare-and-swap path has been verified with concurrent stale-write
rejection. No user-facing grant route is exposed while the workspace flag is
disabled.

PR2 implementation status (updated 2026-08-09): the structured editor, explicit
user-confirmed save, immutable revision history and restore-as-new-revision behavior,
derived length estimate, authenticated API boundary, and editor contract tests
are implemented behind `GRANT_WORKSPACE_ENABLED`. Migration 035 contains only
owner-scoped revision read RPCs and was applied to production on 2026-08-07.
The real PostgreSQL path and the local browser path against the production
database were verified on 2026-08-07, including revision commit, reload recovery,
restore-as-new-revision, and stale concurrent-write rejection. Production
feature exposure remains disabled pending an independently authorized rollout.

PR3 implementation status (2026-08-07): checker/run, Finding, conflict and
source-anchor contracts; the Diagnostic Assembler; a deterministic structural
completeness checker; conservative cross-revision relocation; an authenticated
diagnostic API; isolated repositories; migration 036; and repeatable contract
tests are implemented. The accepted eight-case anchor-drift decisions pass in
TypeScript. Migrations 036 and 037 are applied to production; Finding
persistence, owner isolation, atomic rollback and cleanup were verified against
the real PostgreSQL database. The phase remains unexposed while the workspace
flag is disabled.

PR3 diagnostic expansion status (2026-08-09): the existing production
composition now uses one deterministic checker registry covering structural
substance, citation visibility, repeated content and explicit terminology-
definition consistency. It reuses the existing checker, Finding, persistence
and incremental-recheck contracts, assigns no severity, and introduces no
parallel diagnostic workflow or model call.

PR3 semantic diagnostic extension status (2026-08-09): the existing diagnostic
execution now composes the deterministic registry with one GPT semantic
checker. The same Grant AI configuration and Model Data Gateway are used by
semantic diagnosis and AI Patch. GPT failure preserves deterministic results
but is projected as incomplete rather than a successful full diagnosis. No new
route, persistence model, worker or canonical write path is introduced.

PR3 semantic reliability update (2026-08-09): semantic diagnostics use a
versioned strict Structured Output contract and one Grant-owned two-call budget.
Truncation, filtering, refusal, invalid structure, out-of-scope references and
provider failures are projected separately. A second call is permitted only
for an explicitly recoverable category, and token usage is accumulated across
both attempts. No raw application or model text is copied into diagnostic
telemetry.

Semantic atomic-location update (2026-08-10): production evidence showed that
a full-document GPT run could return nonexistent section/node combinations even
when both identity fields looked structurally valid. The provider boundary now
assigns one deterministic atomic `locationRef` to every authorized node, reuses
the frozen map across retries and resolves references back to canonical UUIDs
before assembly. Invalid primary references discard their Finding; invalid
related references are contained at field/Finding scope instead of rejecting an
otherwise usable run. Provider/run contract V4, prompt V4, policy v3.2, checker
4.0.0 and migration 046 are staged. A real signed-in run remains required after
migration and deployment.

Hierarchical semantic diagnostic contract status: Impact Analysis 0017,
ADR-0017 and pure target schemas freeze the next architecture without changing
production. ArgumentMap is descriptive per-run scaffolding; canonical nodes and
the existing Diagnostic Assembler remain the only continuity authority. Strict
contract tests cover role completeness, the Step A/Step B responsibility split,
no severity and wording-free canonical continuity. Runtime, persistence,
budgets, flags and UI remain on Semantic V4 until later staged work.

Hierarchical semantic diagnostic input status: the existing V4 atomic-location
builder is now the single reusable mapping authority. A pure target adapter
derives Step A and Step B base requests from one already-authorized prepared
input, binds them to one deterministic revision-scoped fingerprint and reuses
the exact canonical resolver maps. It performs no provider call, evidence
lookup, persistence or production selection. Semantic V4 behavior remains
covered by its existing input tests.

Hierarchical ArgumentMap status: the descriptive system prompt, strict provider
schema call, canonical reference resolver and program-level role/relation
validation are implemented behind an unused target adapter. Step A cannot emit
diagnoses, recommendations, severity or funding predictions; it uses only the
frozen `N*` scope and returns a revision-bound canonical map. The adapter has no
local retry. Production composition, persistence, UI and Semantic V4 selection
remain unchanged until subsequent stages are authorized and verified.

Hierarchical root-diagnosis status: Step B now consumes the validated Step A map
through the same frozen location scope, asks one model call to group repeated
manifestations into root issues, and deterministically resolves occurrences and
Evidence Card IDs. Invalid related references degrade at field scope; invalid
primary occurrences and unauthorized-evidence findings are not published. No
severity, priority or funding prediction is accepted. The target adapter remains
unused by production; unified budget, persistence, projection and rollout are
later stages.

Hierarchical execution-policy status: one aggregate executor now owns the target
call ceiling (`1` ArgumentMap, `2` root diagnosis, `3` total), accumulates usage
from failed and successful calls, classifies retryable failures and changes the
retry condition. It exposes a successful ArgumentMap as a resumable checkpoint
and validates revision/scope before reuse. This checkpoint is not durable yet;
persistence and production recovery remain later work. Production composition
and Semantic V4 selection remain unchanged.

Semantic Review V6 unified-execution status (2026-08-12): the target-only Fact
Map, Scientific Review and Narrative Review adapters now run through one
aggregate executor. The normal path uses three calls; the aggregate ceiling is
four calls and one exceptional recovery across both review stages. Fact Map is
single-attempt, deterministic failures do not retry, current image authorization
is rebuilt before each Narrative attempt, and revision/scope-bound in-memory
checkpoints can resume after Fact Map or Scientific Review. Production
composition, persistence, rollout and user-visible Semantic V5 behavior remain
unchanged until later authorized steps.

Semantic Diagnostic V3 planning status (2026-08-09): the contract, impact
analysis and ADR are frozen in Impact Analysis 0015 and ADR-0015. This step
changes no runtime behavior. Implementation must remain staged: strict schema
and fixtures; model input/evidence boundary; prompt and unified executor;
assembler/location/fingerprint; additive persistence and normalized projection;
then UI, historical activation and real signed-in verification. V3 must use the
existing `AI诊断` action and semantic checker authority, not a parallel route.

Semantic Diagnostic V3 contract implementation status (2026-08-09): the V3
provider schema, stricter program-validation schema, supplied-reference guard
and category-boundary fixtures are implemented but are not connected to the
production prompt or adapter. Provider compatibility tests require every field,
represent absence with null/empty arrays, and reject unsupported JSON Schema
keywords. Production remains on V2 until the later gateway and executor stages
are complete and effect-first verification authorizes activation.

Semantic Diagnostic V3 input-boundary status (2026-08-09): a pure model-input
builder now freezes canonical section/node order, funding category, compact
prior-Finding identity and evidence provenance before a provider call. Evidence
Cards carry authorization revision and content hashes; verified cards are
bounded to the exact supplied excerpt, while metadata-only cards expose no
excerpt and can establish record existence only. The builder rejects unknown,
mismatched or duplicate document/evidence IDs. It is contract-tested but is not
yet invoked by the production semantic checker; V2 runtime behavior is unchanged.

Semantic Diagnostic V3 prompt/executor status (2026-08-09): the accepted review
policy is encoded as one versioned system prompt with category boundaries,
untrusted-input rules, evidence-scope limits and no severity or funding-outcome
prediction. The existing OpenAI Grant adapter owns a V3 strict-output method
with the same two-attempt failure taxonomy, accumulated usage and bounded
schema/capacity recovery. It is contract-tested with GPT-5.5 request semantics
but is not selected by production composition; V2 remains active until the
assembler, persistence projection and rollout gates are complete.

Semantic Diagnostic V3 assembler status (2026-08-09): a pure Grant-owned
assembler now validates supplied references, assigns Finding identity and
lifecycle fields, normalizes related locations, orders Findings by canonical
document position and derives a stable fingerprint from checker contract,
category, diagnostic fact and source locations. Recommendation wording,
possible consequence, confidence, actionability and provider return order do
not affect identity. The assembler is intentionally in-memory only; it does not
write V3 data or change the active V2 diagnostic path before the additive
persistence and normalized-projection migration is complete.

Semantic Diagnostic V3 persistence/projection status (2026-08-09): migration
045 defines additive V3 content and related-location tables attached to the
existing `grant_findings` envelope. The Grant Diagnostic Repository owns one
transactional V3 save operation that first writes the compatibility envelope
through the existing persistence function, then writes V3 detail in the same
database transaction. A single normalized V2/V3 read projection is available
below the UI boundary. Existing V2 readers and production composition remain
unchanged. Migration 045 was applied to production on 2026-08-09; V3 writes
remain inactive. Local repository and rollback contracts pass, while the real
PostgreSQL write/rollback drill still requires separately authorized temporary
production fixtures.

Semantic Diagnostic V3 rollout status (2026-08-09): the existing `AI诊断`
action and semantic-checker authority can now select V3 through
`GRANT_SEMANTIC_DIAGNOSTIC_V3_ENABLED`. The service assembles and persists the
rich V3 result without first degrading it to V2, while normalized reads keep
historical V2 and V3 records readable and project the latest successful checker
run. The right panel displays diagnostic fact, reason, recommendation, possible
reviewer question and related locations; its default order remains canonical
document order, never actionability or confidence. Local rollout, compatibility
and type contracts pass. Production activation and a signed-in real GPT run
remain pending effect-first verification; the flag stays off until separately
authorized.

PR4 implementation status (2026-08-08): the three-pane workspace, collapsed
Finding cards, source navigation, user feedback persistence and production
navigation entry are implemented and exposed behind `GRANT_WORKSPACE_ENABLED`.
Migration 038 is applied and the production PostgreSQL feedback path is
verified. PR4.5 adds the missing existing-draft entry as an import adapter; it
does not introduce a second canonical document path.

PR5 implementation status (2026-08-08): evidence-free single-node AI patch
contracts, the Grant Model Data Gateway, model adapter, durable proposal
repository, diff preview, explicit accept/reject actions, stale-revision and
scope guards, idempotent acceptance recovery, and revision audit linkage are
implemented behind `GRANT_AI_PATCH_ENABLED`. Contract, architecture, regression,
type and production-build checks pass. Migration 039 is applied, the production
flag is enabled, and the real browser proposal/diff/reject path is verified. The
production accept action was intentionally not exercised against user content;
its compare-and-swap and idempotent recovery remain contract-tested.

PR6 implementation status (2026-08-08): project evidence contracts,
deterministic Evidence Cards, independent permissions, current-authorization
CAS, transactional revocation propagation, recoverable deletion, owner-scoped
routes and the project-resource UI are implemented behind
`GRANT_LOCAL_EVIDENCE_ENABLED`. Contract, architecture and existing Grant
regression suites pass locally. Migration 040 is applied and the production
flag is enabled. The production browser path is verified with a non-sensitive
TXT fixture: upload, deterministic Evidence Card creation, default-deny model
permissions, authorization update, revocation and recoverable deletion all
completed successfully; the fixture and its object were deleted afterward.

PR7 implementation status (2026-08-09): the existing Patch path now accepts
optional authorized evidence sources. The Grant Model Data Gateway rebuilds a
bounded evidence context from current authorization, rejects highly sensitive
sources, validates model-returned Evidence Card IDs, records excerpt-free
provenance, and rechecks authorization before acceptance. Migration 041 keeps
proposal persistence and revocation dependencies in one transaction, and keeps
the acceptance evidence guard, Revision CAS, and proposal status transition in
another single transaction. The
evidence-free PR5 path remains unchanged. Contract, architecture, encoding,
type, UI-structure and production-build checks pass locally. Migration 041 is
applied and the guarded-acceptance RPC resolves remotely. Production deployment
and a real signed-in evidence-backed model call, revocation behavior and
acceptance remain to be verified.

PR8 implementation status (2026-08-09): bounded section-level recheck,
identical-input reuse, current-Finding projection, deterministic convergence
summary, a dedicated Grant DOCX export port/adapter, guarded API route and UI
entry are implemented behind `GRANT_RECHECK_ENABLED` and
`GRANT_DOCX_EXPORT_ENABLED`. Migration 042 is additive and was applied to
production on 2026-08-09; both capability flags are enabled for production.
Effect-first verification found that the initial run-history RPC represented an
absent optional failure code as JSON null. Migration 043 corrects the projection
contract without rewriting historical runs.
Contract, architecture, encoding, type and existing diagnostic/UI regression
checks pass locally. A real DOCX was generated and its OOXML structure was
inspected; page-image visual QA remains incomplete because LibreOffice is not
installed in the verification runtime.

## Feature Flags

The product begins disabled. Planned flags are capability gates, not alternative
business implementations:

```text
GRANT_WORKSPACE_ENABLED
GRANT_AI_PATCH_ENABLED
GRANT_LOCAL_EVIDENCE_ENABLED
GRANT_EVIDENCE_PATCH_ENABLED
GRANT_RECHECK_ENABLED
GRANT_DOCX_EXPORT_ENABLED
```

Turning off an enhancement must not make canonical content unreadable or delete
user data.

## Imported Figure Diagnosis Sequence

Imported-image support is added inside the existing grant import, canonical
document and semantic diagnostic stages. It is not a new top-level pipeline.

1. **Contracts (completed 2026-08-10):** define one program-owned imported
   figure asset, deterministic OOXML anchor/caption metadata and revision-bound
   model authorization. Runtime behavior remains unchanged.
2. **Extraction and storage (completed 2026-08-10):** extract embedded DOCX image parts, verify hashes,
   use immutable object paths and create canonical `figure` nodes in source
   order. Preserve unsupported formats with explicit fidelity warnings.
3. **Workspace rendering (verified 2026-08-11):** resolve owner-scoped assets
   through a private read adapter and render them at their canonical position
   without changing editor revision ownership. Migration 049, the signed
   private-byte path and the real workspace display were verified in production.
4. **Model-data admission (implemented 2026-08-10):** add an explicit user
   consent surface and a single Figure Model Authorization Service. Consent is
   denied by default, asset-scoped, compare-and-swap protected and invalidated
   by a canonical Revision change. The current authorization can be
   materialized for the Model Data Gateway, but this step does not yet transmit
   image bytes to a provider.
5. **Multimodal diagnosis (implemented 2026-08-10):** the existing hierarchical
   semantic checker keeps ArgumentMap text-only and sends current, authorized
   raster bytes only to each paid root-diagnosis attempt. Admission re-reads
   revision-bound consent, verifies asset size/hash and uses execution-local
   image/location references. Unauthorized or unusable figures degrade to
   text-only diagnosis with explicit image coverage; figure-bearing documents
   never reuse an older successful semantic run without rechecking consent.
6. **Effect-first verification and rollout (completed 2026-08-11):** a temporary
   figure was inserted into a real NSFC DOCX and imported through production.
   Source order, caption binding, private workspace display and complete browser
   image loading were verified. The owner-scoped Semantic V5 canary then proved
   both paths: authorized diagnosis supplied 1/1 raster asset to the provider;
   after revocation a new run supplied 0/1 assets, completed text-only and
   exposed `not_authorized` coverage. The temporary project was recoverably
   archived after verification. Global rollout remains separately authorized.

Each step replaces a missing capability within an existing owner. No parallel
import route, canonical model, model gateway, diagnostic button or Finding
repository is authorized.

## Migration and Rollback

Database changes are forward-compatible: add, backfill, switch readers/writers,
verify, then remove old data only in an independently authorized change.

Every phase records:

- Git revision/tag;
- database migration version;
- flag state;
- verification report;
- known limitations;
- rollback behavior.

A copied parallel code path is not a rollback strategy.

## Hierarchical Diagnostic Step 6 Status

The target Diagnostic Assembler derives wording-free occurrence and root
continuity fingerprints, attaches root cards to the existing Finding envelope
and exposes every manifestation through the normalized projection. Migration
047 defines additive V4 detail tables and revision/scope-bound ArgumentMap
checkpoints. The existing right panel can show one root card with navigation to
each canonical occurrence. Migration 047 is applied. Production composition
remains unchanged outside the explicit owner canary; the authorized owner uses
Semantic V5 while other owners remain on the existing selection path.

## Hierarchical Diagnostic Step 7 Status

The existing semantic checker can now select the two-stage implementation
through a fail-closed, owner-stable server cohort. Selection requires both a
rollout mode and explicit database schema `047` readiness; invalid or incomplete
configuration keeps the current Semantic V4 implementation. The existing
route, button, checker ID, Diagnostic Service, repository and normalized
projection are reused. A paid Step A result can resume from its revision/scope-
bound checkpoint, and successful root Findings use the atomic migration 047
save operation.

Local contract, compatibility, type and architecture verification is complete.
Migration 047 is applied and an owner-scoped production canary is enabled. A
signed-in real GPT run completed in multimodal mode, and a second run after
authorization revocation completed in explicit text-only mode. Global rollout
is not enabled; rollback is the existing hierarchical diagnostic mode flag.

## Semantic Review Quality Step 1 Status

The dual-node target contract is implemented without changing production.
Existing `GrantNode.nodeId` remains the only canonical physical-node identity;
model-recognized scientific questions, innovation claims, objectives,
mechanisms, metrics and evidence use revision-bound execution-local semantic
references anchored to canonical node ranges. Cross-run semantic calibration
excludes those aliases and model prose and defines an explicit `ambiguous`
state. Impact Analysis 0019 and ADR-0019 reserve coordinated V6 target versions.
Active Semantic V5 constants, canary selection, provider calls, persistence and
UI remain unchanged.

## Semantic Review Quality Step 2 Status

The target-only Fact Map coverage contract is implemented. Every frozen
semantic object now requires one explicit disposition: residual gap found,
verified with no residual gap, or unable to verify. A pure program-owned quality
gate checks full object coverage, type agreement, Finding bindings and orphan
Findings; it does not infer completeness from model prose. Strict provider
schema compatibility and business-invariant regressions are included. Active
Semantic V5 calls, persistence, rollout and UI remain unchanged.

## Semantic Review Quality Step 3 Status

Target-only Scientific Finding V1 and Narrative Finding V1 contracts are
implemented as separate strict provider and bounded program schemas. Scientific
Findings acknowledge existing design and its evidence tier before naming a
residual gap. Narrative Findings describe presentation, reader friction and a
bounded organization suggestion without borrowing scientific-gap fields.
Severity and priority are absent, visual findings require resolved figure
assets, and Finding references are unique across both families. Active Semantic
V5 calls, persistence, rollout and UI remain unchanged. Frozen V6 model input
and Fact Map construction were reserved for Step 4.

## Semantic Review Quality Step 4 Status

The frozen V6 prepared input and descriptive Fact Map construction are now
implemented as target-only infrastructure. The adapter reuses the existing
Model Data Gateway location, Evidence Card and figure admission maps and scope
fingerprint. The model identifies semantic type/facet and selects supplied
`N*` locations only; the program allocates `S*`, resolves canonical anchors and
computes hashes. Fact Map output cannot contain diagnosis or recommendations.
No production model operation, persistence, migration, rollout or UI changes in
this step. Scientific review execution is Step 5.

## Semantic Review Quality Step 5 Status

Target-only Scientific Review V6 execution is implemented. It consumes the
frozen V6 input and mature Fact Map, applies verify-before-report instructions,
returns Findings and explicit coverage in one strict response, resolves every
semantic/location/evidence alias programmatically and runs the Fact Map
coverage gate. Metadata-only evidence cannot support a scientific conclusion;
invalid related locations degrade locally while invalid primary or existing-
design locations reject the result. The adapter performs one paid attempt with
a caller-supplied completion budget and no private retry. Production selection,
persistence, migration and UI remain unchanged. Narrative Review is Step 6.

## Semantic Review Quality Step 6 Status

Target-only Narrative Review V6 execution is implemented as a separate
presentation axis. It reuses the frozen V6 document/location scope and the
existing current image-admission provider, produces only Narrative Finding V1,
resolves all `N*` and `I*` aliases programmatically, and forbids visual findings
when no image was actually supplied. The adapter performs one paid attempt with
a caller-supplied completion budget and no private retry. Production selection,
persistence, migration and UI remain unchanged. Aggregate budgeting,
persistence and rollout are later steps.
