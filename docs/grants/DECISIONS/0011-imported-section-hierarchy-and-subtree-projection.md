# ADR-0011: Imported section hierarchy is classified once and projected consistently

- Status: accepted
- Date: 2026-08-09
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

NSFC DOCX templates often render headings as ordinary paragraphs rather than
Word heading styles. Repeating heading heuristics in each UI surface would
create multiple authorities for document structure.

## Decision

The grant DOCX importer is the sole authority for classifying imported paragraph
headings. Classification is restricted to the editable report-body window and
produces the existing canonical parent/child hierarchy. Presentation code may
only derive ordered tree, breadcrumb, and selected-subtree projections from
`parentSectionId` and sibling `order`.

The canonical snapshot and whole-document revision compare-and-swap remain
unchanged.

## Consequences

- No parallel node model, revision model, renderer, or database migration is added.
- Cover and attachment/integrity sections are not treated as editable body headings.
- Existing imports are not silently rewritten; users re-import to obtain the structure.
- Image extraction remains governed by ADR-0004.

## Verification

- `npm run test:grant-docx-import`
- `npm run test:grant-workspace-ui`
- `npm run check:grant-architecture`
