# Impact analysis: Explicit web mode on existing assistant route

- Extends the existing assistant request with one optional boolean; old clients
  and ordinary requests remain valid.
- Adds one visible toggle only when all server readiness gates pass.
- Keeps conversation persistence, response rendering and document-only fallback
  in the existing Grant Assistant service and route.
- Does not alter the user-confirmed OpenAlex-to-Evidence workflow.
- Fixes migration 067 telemetry constraints to include the already registered
  query-rewrite Operation and policy.
- Adds a price-catalog readiness marker so enabled-but-unpriced traffic cannot
  enter the provider path.
- No migration was applied, no price row or secret was written, no provider was
  called, and no deployment or signed-in browser verification occurred.
