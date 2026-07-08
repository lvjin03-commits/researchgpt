<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Chrome Extension

The Google Scholar MV3 extension lives in `extensions/google-scholar/`.

- Read `docs/EXTENSION.md` before changing extension or `/api/extension/*` routes.
- Content scripts parse visible Scholar DOM only on user click; no background scraping.
- Service worker calls `POST /api/extension/save-paper` with Bearer token from `chrome.storage.local`.
- Shared save logic: `lib/literature/server/extension-paper.ts`.
- Extension auth: `lib/literature/server/extension-auth.ts` (Bearer token or cookie fallback).
