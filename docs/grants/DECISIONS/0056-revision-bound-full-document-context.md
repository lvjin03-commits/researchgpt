# ADR 0056: Revision-bound full-document assistant context

- Status: accepted, Steps 1-4 implemented
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
that cannot fit by itself is subdivided deterministically at node boundaries and,
when required, into lossless text fragments that retain the original source
alias. Every unit analysis may cite only aliases present in that unit. Final
synthesis may cite only aliases present in the complete Revision projection and
is rejected when all intermediate analyses do not fit its declared capacity;
the program never drops intermediate results to force a response. The Grant Model Data Gateway remains
responsible for provider admission. Keyword retrieval may
select emphasis, but it cannot be represented as whole-document coverage.

Explicit whole-application questions in ordinary Grant Assistant chat now route
through this authority. The visible user action and billable Operation remain
`grant.assistant.chat`; its unified executor records the aggregate usage of the
single-pass or hierarchical provider work. Explicit selection, Candidate,
Evidence and web-search turns retain their established authorities and cannot be
silently reinterpreted as whole-document analysis.

## Consequences

- Full coverage becomes programmatically testable before any provider call.
- Long-document chunking can reuse the same aliases and fingerprint.
- Capacity decisions carry their tokenizer and policy versions for auditability.
- Exact token counts apply to assembled text; protocol and safety reservations
  remain explicit policy inputs rather than hidden estimates.
- Hierarchical execution carries a content-derived execution fingerprint and
  explicit section/source coverage evidence.
- Narrow ordinary chat retains the existing six-node retrieval path.
- Figure bytes, Evidence Cards, Patch authority and Revision writes are unchanged.

