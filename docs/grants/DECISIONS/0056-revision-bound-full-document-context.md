# ADR 0056: Revision-bound full-document assistant context

- Status: accepted, Steps 1-2 implemented
- Date: 2026-09-14
- Owner: Grant Model Data Gateway

## Decision

Whole-application analysis will consume one deterministic full-document context
built from the current canonical Revision. The projection includes every section
and every node in canonical order, uses execution-local aliases for model-facing
references, and carries a Revision/content fingerprint plus exact coverage facts.

This projection is not a second document model and has no persistence or model
dispatch authority. One capacity router uses the selected provider policy and
the provider-family tokenizer to decide whether the complete projection fits a
single request. It reserves output, protocol and safety capacity before routing.
If the complete projection does not fit, it emits complete-section chunks for
hierarchical processing; it never silently truncates the projection. A section
that cannot fit by itself is explicitly reported as oversized for the later
hierarchical executor to subdivide. The Grant Model Data Gateway remains
responsible for provider admission. Keyword retrieval may
select emphasis, but it cannot be represented as whole-document coverage.

## Consequences

- Full coverage becomes programmatically testable before any provider call.
- Long-document chunking can reuse the same aliases and fingerprint.
- Capacity decisions carry their tokenizer and policy versions for auditability.
- Exact token counts apply to assembled text; protocol and safety reservations
  remain explicit policy inputs rather than hidden estimates.
- Current six-node chat retrieval is unchanged until the later routing step.
- Figure bytes, Evidence Cards, Patch authority and Revision writes are unchanged.

