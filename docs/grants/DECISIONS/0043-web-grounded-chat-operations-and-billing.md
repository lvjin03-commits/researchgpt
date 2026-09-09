# ADR 0043: Web-grounded chat Operations and billing

## Status
Accepted as step 5 registration; runtime and price policies remain disabled.

## Decision
The visible user action remains `grant.assistant.chat`. A program-owned web
orchestrator may later execute three fixed child Operations:

1. `grant.web_search.query`: one approved search-provider query;
2. `grant.web_source.assess`: model relevance assessment over bounded results;
3. `grant.web_answer.synthesize`: final source-bound answer.

Each child has its own trace, at-most-once billing operation ID, immutable price
policy version, usage kind and one Bundle. Search is tool-call usage; assessment
and answer are token usage. Model semantics cannot select or rename Operations.

Blocked egress, cache hits, no search results and discarded internal assessment
map to non-delivered terminal states and release reservations. Only delivered
usage is charged. Partial delivery charges only an independently delivered
Bundle. Unknown states fail closed to release. Provider cost incurred without a
user-deliverable result is borne by the service, not silently charged.

No numeric price is invented here. Production requires provider-specific,
effective-dated price catalog entries and rollout approval. Model telemetry
database constraints also require a migration before either new model Operation
can execute; until then there is no runtime route to them.
