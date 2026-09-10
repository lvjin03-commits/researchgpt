# ADR 0048: Web grounding provider composition is server-only and fail-closed

## Status
Superseded by ADR 0050 for the general-web Provider. The model adapter and
server-only composition rules remain active.

## Decision
The web-grounded Grant Assistant uses a dedicated OpenAI adapter implementing
the existing `GrantWebGroundingModel` port. It performs query rewrite, source
assessment and answer synthesis with strict structured-output schemas. The
adapter receives only context admitted by the Grant Model Data Gateway and
metadata/snippets returned by the approved search provider. It never crawls or
stores page bodies.

The existing server composition root is the sole runtime construction owner. It
returns `null` unless the web-grounding feature flag and schema version gate are
both enabled. When enabled, construction additionally fails closed unless the
server has the OpenAI key, Google Custom Search key and search-engine ID. These
secrets use unprefixed server environment variables and are never placed in a
client bundle.

No API route or UI is connected in this step. The existing Grant Assistant
service remains authoritative for ordinary chat and fallback execution.

## Consequences
Provider-specific prompts and error normalization are isolated behind a port,
while execution telemetry, retries, billing usage and grounded-answer
validation remain owned by existing application services. Enabling the flag
without completing migration 067 and provider configuration cannot silently
degrade into an untracked path.
