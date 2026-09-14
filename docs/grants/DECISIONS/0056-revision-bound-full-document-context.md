# ADR 0056: Revision-bound full-document assistant context

- Status: accepted, Step 1 implemented
- Date: 2026-09-14
- Owner: Grant Model Data Gateway

## Decision

Whole-application analysis will consume one deterministic full-document context
built from the current canonical Revision. The projection includes every section
and every node in canonical order, uses execution-local aliases for model-facing
references, and carries a Revision/content fingerprint plus exact coverage facts.

This projection is not a second document model and has no persistence or model
dispatch authority. The Grant Model Data Gateway will remain responsible for
capacity routing and provider admission in later steps. Keyword retrieval may
select emphasis, but it cannot be represented as whole-document coverage.

## Consequences

- Full coverage becomes programmatically testable before any provider call.
- Long-document chunking can reuse the same aliases and fingerprint.
- Current six-node chat retrieval is unchanged until the later routing step.
- Figure bytes, Evidence Cards, Patch authority and Revision writes are unchanged.

