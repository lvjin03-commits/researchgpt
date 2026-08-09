# ADR 0010: Incremental Recheck and Deterministic Grant Export

- Status: Accepted
- Date: 2026-08-09

## Context

The Grant workspace already has immutable checker results and a canonical
Revision model, but repeated checks always scan the whole document and the UI
cannot distinguish improvement from an unchanged issue set. There is also no
formal DOCX exporter for canonical grant content.

## Decision

Diagnostic Service derives changed sections from the current and parent
Revisions. It may use `section_bundle` only when every active checker explicitly
supports that mode and the affected scope is bounded; otherwise it uses
`full_document`. Successful identical inputs are reused. Stable Finding keys are
stored in run metadata so convergence is a deterministic projection, not a new
model judgment.

Grant Export Service reads only the current Revision and frozen Template
Snapshot. A dedicated adapter produces DOCX with Word styles and deterministic
objects. It cannot generate missing semantic content, call a model, or import
Document V2 orchestration.

## Consequences

- Historical Findings remain immutable while the UI can show only the current
  checker projection and explain recheck progress.
- Full-check behavior remains available when the recheck flag is disabled.
- Export can be independently disabled without affecting editing or diagnostics.
- Missing figure binaries or bibliography metadata are disclosed as warnings;
  internal identifiers are never turned into visible document text.
