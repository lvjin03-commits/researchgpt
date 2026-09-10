# ADR 0047: Web-grounded chat uses one controlled orchestration

## Status
Accepted as the orchestration baseline; its Google Provider selection is
superseded by ADR 0050.

## Decision
Explicit web-enabled Grant Assistant turns use one application orchestrator:
query rewrite, deterministic egress review and durable audit, Google Custom
Search, source relevance assessment, grounded answer synthesis, deterministic
claim/source/copying validation, and document-scoped usage-event persistence.

Query rewrite, relevance assessment and synthesis are three named model
Operations. Every operation runs through the existing Grant Model Executor with
an independent trace and retry policy. Search remains a separately metered
non-model operation. The assistant's existing answer contract is the only
successful output contract.

Application content can enter this path only as a bounded admitted context built
by the Grant Model Data Gateway from the current canonical revision. The model
may propose a generalized search query, but deterministic egress policy owns the
decision to send it externally. Source trust, IDs, event identity and citation
identity remain program-owned.

Failures return a stable `fallback_required` directive. They do not manufacture
a second answer format or a parallel fallback model path. A future composition
owner may invoke the existing document-only assistant operation after that
directive.

## Consequences
The flow is testable without paid calls and produces traceable source-use
history. Runtime activation still requires schema 067, provider secrets, price
policies, charging integration, explicit UI routing and signed-in effect-first
verification. This ADR does not authorize any of those production changes.
