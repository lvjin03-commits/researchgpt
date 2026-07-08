# Project Status

Last Update: 2026-07-08

## Current Focus

Improve literature search quality so ResearchAI results feel closer to Google Scholar-style relevance while preserving the existing provider architecture.

## Completed

- Added Search Quality v1 rule-based ranking signals:
  - research direction matching
  - exact phrase matching
  - provider reliability
  - metadata completeness
  - publication type quality
- Added a conservative ranking score floor for larger result sets.
- Added debug ranking breakdown data for literature search diagnostics.

## Verification

- `npx tsc --noEmit` passed.
- `npx eslint components/literature-debug-panel.tsx lib/literature/providers/index.ts lib/literature/ranking/ranking.ts lib/literature/ranking/score.ts lib/literature/search-debug.ts lib/literature/server/search-debug.ts` passed.
- `npm run lint` was attempted, but existing unrelated lint errors remain in chat and literature detail/folder selector files.
- `npm run build` was attempted, but the environment could not fetch Google Fonts for `next/font`.
