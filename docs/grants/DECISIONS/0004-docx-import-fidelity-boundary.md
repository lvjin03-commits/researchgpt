# ADR-0004: DOCX import preserves canonical body structure, not arbitrary Word fidelity

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

A deterministic round-trip fixture contained 19 body nodes, six headings, two
lists, one table, one image, two sections, one header part, and one footer part.
Import to the minimum canonical body model and no-op export preserved all 19
body nodes, body text hash, table content, and image hash. It reduced two
sections to one and omitted header/footer parts. Visual rendering could not be
completed in the non-interactive environment.

## Decision

The canonical structured document owns editable semantic body content. DOCX
import must preserve the original file and emit a machine-readable fidelity
report for unsupported layout or OOXML features. Unsupported features may not
be silently discarded or represented as editable canonical content.

## Consequences

- PR1 may implement body nodes without promising arbitrary DOCX round-trip.
- Section geometry, headers/footers, floating shapes, fields, comments,
  revisions, footnotes, and complex formulas require explicit adapter support
  or a fidelity warning.
- Real page render comparison remains an exit gate before shipping import/export.

## Verification

- `scripts/grant-spikes/run_spikes.py`
- Measured result in `docs/grants/spikes/README.md`
