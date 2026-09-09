# ADR 0042: Grant web-search query egress

## Status
Accepted for step 4; no external search integration is enabled.

## Decision
Every query sent to an external search provider must pass one deterministic,
versioned egress policy after query rewriting and immediately before dispatch.
The policy reads the current canonical document text and program-supplied
sensitive terms. It blocks contact details, URLs/network identifiers, project
identifiers, precise numeric parameters, named sensitive terms, long verbatim
document overlap and excessive query length. A failure triggers a safer rewrite
or stops search; it never falls through to provider dispatch.

The document itself and sensitive-term list are not audit payloads. Allowed
events record the exact string actually sent, its hash, policy version,
provider, document/revision and actor. Blocked events record only the normalized
candidate hash and issue codes, never the rejected candidate text. Audit events
are append-only through a dedicated port; persistence is a later step.

This policy reduces disclosure but does not claim perfect name/entity detection.
Callers must derive sensitive terms from current document metadata and approved
classification. It is not Model Data Gateway admission, provider authorization,
SSRF protection, content trust or permission to write the application.

## Consequences
Google/OpenAlex adapters cannot receive raw application text or bypass this
gate. A model may propose a general search phrase but cannot approve its own
egress. Policy/version changes require a new version and regression cases.
