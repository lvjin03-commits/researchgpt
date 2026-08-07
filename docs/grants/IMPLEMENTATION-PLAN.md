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

## Delivery Sequence

| Phase | Deliverable | Exit condition |
|---|---|---|
| PR1 | Canonical node model, revision service, template snapshot, base audit | Atomic compare-and-swap and recovery tests pass |
| PR2 | Structured editor, autosave, revision recovery, length estimate | Reload and concurrent-edit scenarios preserve content |
| PR3 | Checker execution, Finding/conflict contracts, cross-version anchors | Every Finding is traceable or explicitly unlocated |
| PR4 | Three-pane UI, collapsed issue cards, bidirectional navigation, feedback | Real source-to-Finding navigation verified |
| PR5 | Evidence-free AI Patch, diff, acceptance, audit | Patch cannot exceed target or overwrite stale revision |
| PR6 | Project resources, Evidence Cards, authorization, deletion | Revocation propagation verified end to end |
| PR7 | Evidence-backed Patch, citation control, evidence safety | Every use maps to an authorized evidence excerpt |
| PR8 | Incremental recheck, convergence control, real DOCX render/export | Real file opens, layout is inspected, recheck is stable |

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
