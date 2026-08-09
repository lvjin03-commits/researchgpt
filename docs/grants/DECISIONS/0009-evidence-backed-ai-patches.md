# ADR 0009: Evidence-backed AI Patch Uses Existing Authorities

- Status: Accepted
- Date: 2026-08-08

## Context

PR5 owns AI Patch proposals and PR6 owns evidence authorization. Evidence must
be usable in a Patch without creating a parallel Patch pipeline or a second
authorization decision.

## Decision

The existing `GrantPatchService` accepts optional source IDs. The existing
`GrantModelDataGateway` asks `GrantEvidenceAuthorizationService` for current,
send-ready resources at dispatch time, selects bounded Evidence Cards, and gives
the model program-issued card IDs. The model returns the IDs it actually used.

The resulting proposal records a minimal evidence provenance projection. It
does not store excerpts or assign citation numbers. Proposal creation and
source dependency registration share one database transaction. Acceptance
rechecks current evidence authorization before Revision Service is invoked.
For evidence-backed proposals, that authorization guard, Revision
compare-and-swap, and proposal acceptance commit in one database transaction;
the database row lock defines the order when revocation races acceptance.

## Consequences

- Evidence-free proposals remain unchanged.
- Revocation invalidates pending dependent proposals.
- Formal citation numbering remains outside PR7 and owned by Citation
  Assembler.
- Disabling `GRANT_EVIDENCE_PATCH_ENABLED` removes evidence selection without
  disabling PR5 or PR6.
