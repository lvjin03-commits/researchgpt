# Impact analysis: web-grounded chat Operations and billing

- Adds three registered internal Operations under one visible assistant turn.
- Extends the existing model policy registry for assessment and synthesis; no
  provider adapter, route or UI can invoke them in this step.
- Reuses the site-wide price catalog, usage schema and deliverability owner.
  Grant code does not introduce a wallet, price calculation or settlement path.
- Search, assessment and answer remain independently attributable and cannot
  share an at-most-once billing ID or price-policy version.
- Egress blocked, cache hit, no results and unused internal output are explicitly
  non-billable. Delivered stages use existing usage-based settlement.
- No prices, provider calls, production secrets, database migration, deployment,
  Evidence authorization or canonical document writes are added.
- Runtime prerequisites: current provider prices, telemetry constraints,
  orchestration, durable audit/persistence, billing reservation integration and
  effect-first signed-in verification.
