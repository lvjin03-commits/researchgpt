# Impact analysis: web-grounded chat Operations and billing

- Adds four registered internal Operations under one visible assistant turn,
  including the query-rewrite stage.
- Extends the existing model policy registry for assessment and synthesis; no
  provider adapter, route or UI can invoke them in this step.
- Reuses the site-wide price catalog, usage schema and deliverability owner.
  Grant code does not introduce a wallet, price calculation or settlement path.
- Query rewrite, search, assessment and answer remain independently attributable and cannot
  share an at-most-once billing ID or price-policy version.
- Egress blocked, cache hit, no results and unused internal output are explicitly
  non-billable. Delivered stages use existing usage-based settlement.
- The OpenAI provider response is now the factual owner of hosted search-call and
  search-response token usage. This replaces the unsafe assumption that one user
  turn equals one hosted search call; it does not move pricing or settlement into
  Grant code.
- No prices, production secrets, database migration, deployment, Evidence
  authorization or canonical document writes are added by metering.
- Charging prerequisites remain: current provider prices, a whole-turn
  reservation range, explicit rollout and effect-first signed-in verification of
  both delivery and the point statement. The generic site-wide coordinator and
  atomic multi-reservation binding now exist, but are not composed into the
  production Grant route while those prerequisites are absent.
