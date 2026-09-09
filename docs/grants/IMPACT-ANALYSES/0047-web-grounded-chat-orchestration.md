# Impact analysis: Web-grounded chat orchestration

- Adds one application orchestrator; it does not add a route, renderer, content
  model, fallback answer implementation or canonical document writer.
- Adds query rewrite as a separately registered model Operation so its telemetry
  and cost cannot disappear into assessment or ordinary chat.
- Adds a Grant Model Data Gateway admission method that accepts only current,
  verified retrieval blocks and emits bounded context plus a content hash.
- Reuses the existing model executor, audited search service, source repository,
  answer contract and deterministic validation gates.
- Failure is represented as a stable fallback directive; ordinary Grant
  Assistant chat remains the sole fallback execution owner.
- No live provider request, secret access, migration application, price
  activation, route/UI wiring, production deployment or formal-content write.
- Offline verification covers the complete successful pipeline and durable
  operation/source-event identities. Product behavior is not yet claimed.
