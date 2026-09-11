# ADR 0043: Web-grounded chat Operations and billing

## Status
Accepted. Runtime metering and the reusable atomic delivery coordinator are
implemented; point charging remains disabled until effective price policies,
bounded per-stage reservation ranges and an explicit charging rollout are approved.

## Decision
The visible user action remains `grant.assistant.chat`. A program-owned web
orchestrator executes four fixed child Operations:

1. `grant.web_query.rewrite`: generalized, egress-safe query generation;
2. `grant.web_search.query`: one approved search-provider response, which may
   contain multiple observed hosted web-search calls;
3. `grant.web_source.assess`: model relevance assessment over bounded results;
4. `grant.web_answer.synthesize`: final source-bound answer.

Each child has its own trace, at-most-once billing operation ID, immutable price
policy version, usage kind and one Bundle. Search is tool-call usage; assessment
and answer are token usage. Model semantics cannot select or rename Operations.

The search adapter reports the provider response ID, actual `web_search_call`
count, input/cached-input/output/reasoning token counts. The orchestrator carries
those facts, together with the three model-stage token usages, to the billing
boundary. It never infers one search call from one user turn.

Blocked egress, cache hits, no search results and discarded internal assessment
map to non-delivered terminal states and release reservations. Only delivered
usage is charged. Partial delivery charges only an independently delivered
Bundle. Unknown states fail closed to release. Provider cost incurred without a
user-deliverable result is borne by the service, not silently charged.

No numeric product price is invented here. Production charging requires
provider-specific, effective-dated price catalog entries, a whole-turn reservation
range, and rollout approval. The site-wide atomic delivery coordinator reserves
all stage maxima in one ledger operation before dispatch. A delivered answer
settles every stage from observed usage and releases unused points; thrown,
unknown or internal-only outcomes release every reservation. Settlement
persistence with an unknown outcome is left for reconciliation rather than being
converted into a potentially incorrect release. Until all prerequisites are
present, usage
remains metering-only and a missing policy must never interrupt the user answer.
