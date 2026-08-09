# PR8 Impact Analysis: Incremental Recheck and Deterministic DOCX Export

## Intended effect

After a user edits an application, the existing Diagnostic Service checks only
the affected section bundle when that scope is safe, explains whether the issue
set improved, stayed unchanged, regressed or resolved, and reuses an existing
run when the current Revision has not changed. The user can download a real
DOCX assembled from the current canonical Revision.

## Authority map

- Revision Service remains the sole owner of canonical content and current
  Revision selection.
- Diagnostic Service owns recheck scope, immutable run reuse, current-Finding
  projection and convergence state. The UI never recomputes these decisions.
- Each checker still owns its conclusion; recheck does not modify historical
  Findings.
- Grant Export Service selects the current Revision. The deterministic DOCX
  renderer owns formatting only and cannot call a model or repair content.
- The frozen Template Snapshot remains the source of document rules. PR8 does
  not add a second template or canonical content model.

## Data and compatibility

Migration 042 adds one owner-scoped read RPC over existing immutable diagnostic
runs. It does not mutate Findings or canonical content. With
`GRANT_RECHECK_ENABLED=false`, the existing full diagnostic path remains
available and does not require the new RPC. With `GRANT_DOCX_EXPORT_ENABLED=false`,
no export entry is exposed and canonical data remains readable.

DOCX export currently renders canonical headings, paragraphs, real Word lists,
tables, formulas and captions. A canonical figure without readable binary asset
is represented by its caption and an export warning. Citation UUIDs are never
shown; missing verified bibliography metadata becomes an export warning. These
are explicit fidelity limits, not model-repaired content.

## DOCX design tokens

The exporter uses the `grant_proposal` narrative preset with an NSFC A4 named
override: A4 portrait, 1 inch margins, 宋体 10.5 pt justified body, 1.5-line
spacing, 微软雅黑 heading ladder, real list numbering, fixed-DXA tables and a
centered page-number footer. The A4 override is required by the target form and
is applied consistently.

## Risks and controls

- Scope omission: incremental mode is allowed only when every checker declares
  section-bundle support and the changed scope covers no more than 60% of the
  document; otherwise the authority runs a full check.
- Recheck loops: identical input hashes reuse the durable successful run;
  unchanged Finding sets are reported as stable rather than automatically run
  again.
- Historical drift: current Findings are projected from the latest successful
  run per checker, while prior Findings remain immutable and auditable.
- Export leakage: internal citation IDs are suppressed, not rendered.
- Cross-context regression: no chat, Document V2, literature or STORM import is
  introduced.

## Verification plan

1. Contract test: full baseline, one-section edit, section-bundle recheck,
   resolved issue, identical-input reuse and current-Finding projection.
2. DOCX test: ZIP validity, real styles, real numbering, fixed table geometry,
   expected visible text and absence of internal IDs.
3. Grant architecture, encoding, typecheck, existing diagnostic and workspace
   regression suites.
4. Production build.
5. Generate a real DOCX and render it to page images. If the runtime lacks
   LibreOffice, record that visual verification remains incomplete rather than
   claiming it passed.

## Rollback

Disable `GRANT_RECHECK_ENABLED` and `GRANT_DOCX_EXPORT_ENABLED`. No canonical
content, prior Revision, Finding or user feedback is deleted. Migration 042 is
safe to leave installed because it is read-only and service-role-only.
