# ADR 0040: Deterministic web source classification

## Status
Accepted for step 2: offline foundation only.

## Decision and ownership
The versioned `grant_web_source_trust_registry` is the sole owner of URL source
classification. Models may rank relevance but cannot assign or override tiers.
The Grant architecture maintainer owns changes, reviewed in a human-reviewed PR;
review every quarter and upon reported misclassification. Each rule records an
ID and policy rationale. Every rule change requires a new registry version and
regression tests. Historical decisions retain their version; rollback restores
the previous version without rewriting history.

Domain classes describe provenance, NOT truth, peer review, claim entailment,
permission to fetch, evidence authorization, or a guarantee against SSRF.
Educational/government suffix rules are conservative project classification
policy, not certification of individual pages. Unknown domains are general web.
No real domain is denylisted without a reviewed justification. Low-trust rules
override positive rules; otherwise the most specific domain wins.

OpenAlex metadata provenance must later be assigned by its trusted server
adapter, never inferred from an untrusted `provider` string. URL classification
alone does not certify arbitrary landing pages as OpenAlex records.

## Scope and migration
No route, provider, database, model schema or billing changes in this step.
Future adapters must consume this authority, not duplicate rules. Runtime
integration remains gated on query-egress policy, source contracts and tests.
ADR 0039 extends ordinary chat; ADR 0034's formal-edit selection and evidence
authorization requirements remain unchanged.
