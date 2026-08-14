# Impact Analysis 0031: Programmatic Edit Candidate Fact Safety

## Outcome

Candidate safety is decided by deterministic diff analysis and authorization-bound claim bindings, never by a model's self-assessment.

## Authority

The Edit Session fact-safety evaluator owns recognition of newly introduced high-risk markers and the resulting candidate state. The model may propose semantic text and source bindings, but it cannot assign claim references, authorize sources or choose `safetyState`.

## State invariants

- No newly introduced high-risk marker: `passed`.
- New numeric or factual assertion without a valid current binding: `needs_confirmation`.
- Every high-risk assertion has a valid current binding: eligible for `passed`.
- New citation marker/reference entry, unknown claim reference or unauthorized source: `blocked`.
- `needs_repair` remains reserved for passive authorization loss discovered before a later turn or apply step.

Only `passed` candidates may become a later turn's semantic base. Conversation ancestry remains intact for audit and UI.

## Scope

This step creates the program-owned report and binding contract. Current text-only turns have no admitted sources, so new factual assertions cannot pass automatically. Evidence, figure and local-file authorization are wired in Step 4.

