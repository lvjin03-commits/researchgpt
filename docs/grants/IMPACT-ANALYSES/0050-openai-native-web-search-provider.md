# Impact analysis: replace Google Custom Search with OpenAI native web search

## Scope

- Replaces the single general-web Provider adapter; no parallel search route is retained.
- Keeps `GrantGeneralWebSearchService` as the egress/audit owner and preserves the
  existing query-rewrite, source-assessment and answer-synthesis Operations.
- Changes the active provider identity from `google_custom_search` to
  `openai_web_search`; migration 068 updates the deterministic database constraint
  while retaining the retired ID for immutable historical-row compatibility.
- Removes Google API key and search-engine ID from runtime prerequisites. The
  existing server-side OpenAI key and configured Grant model are reused.
- Search receives only the generalized query admitted by the existing egress
  policy. Canonical application text is not sent to the search tool.
- Converts only cited OpenAI output spans into bounded source records. Uncited
  consulted URLs are not treated as evidence-bearing snippets.
- Changes the search billing discriminator to `openai_web_search`. Production
  activation still requires an effective price catalog entry and explicit rollout.

## Verification and rollback

- Offline provider tests inject a Responses API-shaped result and make no paid call.
- Grant web-source, assistant, architecture, type and build checks must pass.
- Effect-first verification requires an explicitly authorized paid call followed by
  the signed-in Grant Assistant user path.
- Rollback is deployment rollback plus disabling `GRANT_WEB_GROUNDING_ENABLED`.
  Migration 068 is additive to historical audit data and is not rolled back by
  deleting records.
