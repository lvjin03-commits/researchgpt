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
| PR2 | Structured editor, autosave, revision recovery, length estimate | Reload and concurrent-edit scenarios preserve content |
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

PR2 implementation status (2026-08-07): the structured editor, serialized
autosave, immutable revision history and restore-as-new-revision behavior,
derived length estimate, authenticated API boundary, and editor contract tests
are implemented behind `GRANT_WORKSPACE_ENABLED`. Migration 035 contains only
owner-scoped revision read RPCs and was applied to production on 2026-08-07.
The real PostgreSQL path and the local browser path against the production
database were verified on 2026-08-07, including autosave, reload recovery,
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
