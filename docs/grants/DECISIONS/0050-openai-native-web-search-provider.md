# ADR 0050: OpenAI native web search replaces Google Custom Search

## Status

Accepted and production-verified for web-grounded answers. Observed usage
metering is implemented; point charging remains disabled pending an effective
price policy and explicit charging rollout.

## Context

New Google Programmable Search engines can no longer provide unrestricted whole-
web results, so the accepted Google adapter cannot satisfy the product's general-
web semantics. Keeping it as a hidden fallback would introduce a parallel Provider
with materially different coverage.

## Decision

`OpenAIWebSearchProvider` becomes the sole `GrantGeneralWebSearchProvider`. It uses
the Responses API `web_search` tool with the configured Grant model and receives
only a generalized query that has already passed the deterministic egress policy
and durable pre-dispatch audit.

The Provider returns bounded records only for URL citations present in OpenAI's
answer. The cited text neighborhood becomes the snippet; source trust remains a
deterministic URL-registry decision. The downstream assessment, claim binding,
copy-overlap validation, source persistence and user-facing answer contract remain
unchanged. The Provider cannot write canonical document content.

The Google adapter and its environment dependencies are removed rather than kept
as a fallback. Schema gate 068 prevents activation against the older provider
constraint. Persisted provider enums retain `google_custom_search` solely so
immutable historical rows remain readable; no runtime adapter can create new
Google searches. Search usage is classified as the `openai_web_search` tool-call
discriminator; model/search-content token prices and the tool-call unit price must
be supplied by the versioned site-wide price catalog before charging is enabled.

## Consequences

This path is closer to ChatGPT-style agentic search while retaining ResearchGPT's
application-specific evidence controls. A search may perform more than one hosted
web action, so final metering must use observed provider usage rather than assuming
one user turn equals one search call. No production claim is valid until a paid,
signed-in user-path test confirms citations, latency, persistence and point usage.
