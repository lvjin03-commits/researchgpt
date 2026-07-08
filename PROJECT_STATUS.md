# Project Status

Last Update: 2026-07-08

## Current Focus

Use the open literature provider pipeline for search, skip AI analysis during updates, and keep Google Scholar as a handoff/import path.

## Completed

- Restored Literature Tracker default search source to OpenAlex, arXiv, and PubMed.
- Disabled AI analysis during literature updates.
- Kept Google Scholar handoff links and extension import.
- Added ResearchAI Scholar Saver Chrome extension v1:
  - parses visible Google Scholar results
  - supports select all / clear / save selected
  - stores ResearchAI URL and default folder selection
  - imports selected results into the ResearchAI literature library
- Added Google Scholar import API with Chrome extension CORS support.
- Added Google Scholar as an internal literature source label.
- Added Search Quality v1 rule-based ranking signals:
  - research direction matching
  - exact phrase matching
  - provider reliability
  - metadata completeness
  - publication type quality
- Added a conservative ranking score floor for larger result sets.
- Added debug ranking breakdown data for literature search diagnostics.
- Reduced production update timeout risk by limiting the default pipeline to OpenAlex, arXiv, and PubMed.
- Made literature update requests respect `selectedSources`.
- Parallelized provider fetches during literature updates.
- Reduced update latency by skipping AI analysis during literature updates.
- Fixed tracker responses so a new search returns only the current search result set.

## Verification

- `npx tsc --noEmit` passed.
- `node --check extensions\google-scholar\content.js` passed.
- `node --check extensions\google-scholar\popup.js` passed.
- `npx eslint app/api/literature/imports/google-scholar/route.ts app/api/literature/folders/route.ts lib/http/extension-cors.ts lib/literature/providers/base.ts lib/literature/paper-providers.ts lib/literature/ranking/score.ts` passed.
- `npx eslint components/literature-debug-panel.tsx lib/literature/providers/index.ts lib/literature/ranking/ranking.ts lib/literature/ranking/score.ts lib/literature/search-debug.ts lib/literature/server/search-debug.ts` passed.
- `npx eslint lib/literature/constants.ts lib/literature/normalize-settings.ts lib/literature/server/parse.ts lib/literature/providers/index.ts lib/literature/source-taxonomy.ts` passed.
- `npm run lint` was attempted, but existing unrelated lint errors remain in chat and literature detail/folder selector files.
- `npm run build` was attempted, but the environment could not fetch Google Fonts for `next/font`.
