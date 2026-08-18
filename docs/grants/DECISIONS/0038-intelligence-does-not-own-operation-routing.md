# Decision 0038 — intelligence does not own operation routing

## Status

Accepted as the Phase B contract. No Diff, explanation model call, cache,
migration or new UI behavior is enabled by this decision.

## Decision

Grant assistant intelligence may select an answer presentation mode, resolve a
user-confirmed focus and propose a non-authoritative Suggested Action. It may
not select or execute a consequential operation.

Without a preceding explicit user action, all free text invokes
`grant.assistant.chat`. Only a visible user click can select an Edit Session
turn or Candidate explanation operation. Ambiguous focus remains unresolved
until clicked; subsequent prose does not implicitly resolve it.

Candidate semantic explanation has one authority. The collapsed automatic
summary and expanded explanation are projections of the same versioned
`CandidateExplanation`; no parallel summary path is allowed. Explanation uses
program Diff, program blocking issues, current authorization status, unified
execution telemetry and a deterministic cache key.

Candidate-local default routing preferences can be enabled only by an explicit,
visible and reversible user setting. Learned or inferred routing preferences
are prohibited.

## Consequences

- The interface can anticipate useful actions without acting autonomously.
- A poor answer-mode choice has no canonical side effect.
- Stale suggestions are detected at click time.
- Repeated explanation requests can be deterministic and non-billable.
- Context budget decisions remain server-owned and fail closed when essential
  Candidate or safety data cannot fit.

## Rejected alternatives

- Letting a model infer edit intent and directly open or continue an Edit Session.
- Automatically resolving ambiguous pronouns from later user prose.
- Learning a default edit route from observed behavior.
- Generating Candidate card summaries separately from full explanations.
- Retrying or re-billing an unchanged cached explanation.
