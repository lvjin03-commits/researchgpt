# ADR-0001: Isolated grant context and canonical structured document

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

The grant product requires continuous editing, diagnostics, local patching,
evidence authorization, revision history, recheck, and DOCX delivery. Reusing
chat state or Document V2 orchestration would create competing content and
lifecycle authorities.

## Decision

The grant platform is an isolated bounded context. Its structured node document
is the canonical working representation. DOCX is an import/export representation.
Grant code consumes shared services only through ports and adapters and does not
import chat or Document V2 orchestration internals.

## Consequences

- Revision, diagnostics, patches, evidence, and export share stable node IDs.
- Arbitrary Word round-trip fidelity is not promised and must be measured.
- Existing chat and Document V2 behavior remain unchanged.
- A copied or fallback grant pipeline is forbidden without a superseding ADR.

## Verification

- `npm run check:grant-architecture`
- DOCX round-trip spike before product implementation
- Regression checks when shared adapters are introduced
