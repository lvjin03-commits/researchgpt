# Impact analysis: Web grounding provider composition

- Adds one OpenAI adapter for the three already registered web-grounding model
  Operations; it does not change the ordinary assistant adapter.
- Adds one guarded factory to the existing server composition root; no second
  composition root or API route is introduced.
- Reads only server-side `OPENAI_API_KEY`, `GOOGLE_CUSTOM_SEARCH_API_KEY` and
  `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` after the feature/schema gate succeeds.
- Reuses the Grant Model Executor, Google provider, durable audit/source
  repositories and Grant Model Data Gateway.
- Provider error details are normalized before reaching the application layer.
- Offline tests inject deterministic OpenAI responses. No paid provider call,
  secret access, database migration, runtime activation, UI behavior, document
  write, commit, push or deployment is part of this change.
