# ADR 0058: Final model selects approved research gaps only

## Status

Accepted for the output contract. Production cutover requires the comparison
artifact and trace to be persisted by the formal resumable workflow.

## Context

A final free-form synthesis call can undo earlier controls by recreating an
already-covered suggestion or restoring an adjacent topic that the scope policy
rejected.

## Decision

The final model returns a bounded core judgment and selected current source
group IDs. The program verifies eligibility and required main coverage, then
renders the already-approved residual gap and recommendation. It derives
numbering, source metadata, DOI, evidence origin and rejected-item audit data.

Quantitative findings require structured academic abstract evidence. Search
excerpts remain discovery-only for quantitative claims.

Every result includes a versioned run trace and an explicit legacy-fallback
flag. A renderer cannot fabricate or alter these facts.

## Consequences

The final model remains responsible for concise expression and selection among
optional approved material, but cannot create scientific scope. Persisting and
enabling this contract in the live resumable workflow is a controlled cutover,
not a parallel answer route.
