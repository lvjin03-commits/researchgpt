# Decision 0037 — Persistent assistant keeps explicit operation authority

## Status

Accepted as the Phase A target contract. No product traffic, persistence,
route, model call or UI exposure is enabled by this decision.

## Decision

The Grant workspace may present ordinary discussion and existing Edit Sessions
in one persistent assistant timeline, but the visible Composer Scope state
machine is the sole owner of operation routing:

- `chat` invokes registered operation `grant.assistant.chat` and can produce
  only an assistant answer;
- `edit` references exactly one existing Edit Session and invokes registered
  operation `grant.edit_session.turn` to produce a candidate.

User wording, attached context and model output cannot select or change the
operation. One assistant session may link to multiple Edit Sessions; every edit
candidate reference includes both `editSessionId` and `candidateId`.

Grant Model Data Gateway determines grounding from the effective admitted
context. Any admitted canonical selection, authorized evidence, confirmed
academic snapshot or authorized figure makes the answer
`evidence_grounded`. Grounded answers declare lightweight claim-to-source
bindings; a program validator resolves supplied aliases and current
authorization before the response is represented as grounded.

`grant.assistant.chat` uses the existing Grant Model Executor, call repository,
one-initial-plus-one-controlled-repair ceiling, idempotency and failure
classification. It never falls back to the ordinary chat route.

## Consequences

- Sharing a UI does not create shared write authority.
- Referencing text is a chat-context action; editing text is an explicit scope
  transition.
- The assistant timeline aggregates Edit Sessions but does not own candidates,
  Patch acceptance or canonical Revisions.
- Phase A search is academic-only and reuses OpenAlex confirmation snapshots.
- General reasoning with no source or downstream effect may expire completely;
  grounded and Revision-linked content follows risk-based audit retention.
- Generated images, image editing, generated-asset persistence, image-unit
  billing and derivative-image consent are excluded and require a separate
  impact analysis and ADR.

## Rejected alternatives

- Letting the model infer whether a message is chat or editing.
- Treating edit-like wording as an implicit Patch request.
- Using one assistant session as the only Edit Session and target hash owner.
- Reusing the ordinary product chat route inside the Grant bounded context.
- Treating OpenAlex as general web search.
- Adding image generation to Phase A by reusing imported-figure authorization.
