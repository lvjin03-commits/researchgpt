# Impact analysis: Google Custom Search adapter

- Adds a new Provider adapter without changing OpenAlex semantics.
- Adds one application boundary that guarantees durable egress audit before
  dispatch and converts results through the canonical source-record authority.
- No route, UI, production composition, secret, real provider call, model call,
  price policy, database migration, Evidence authorization or content write.
- The first release consumes snippets/metadata only; it does not crawl pages.
- Failure is fail-closed for absent audit, stale egress policy, invalid config,
  quota, rejected requests and malformed JSON/schema.
- Offline tests inject a fake fetch implementation and prove the exact endpoint,
  query parameters, deduplication, classification and blocked-query behavior.
- Runtime prerequisites remain audit persistence, telemetry/price migrations,
  query rewriting, web-answer orchestration and effect-first signed-in QA.
