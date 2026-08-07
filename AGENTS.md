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

## Effect-First Development

Every user-facing change must be treated as incomplete until the visible effect is verified.

- Read `docs/effect-first-development.md` before claiming that a feature is fixed, finished, deployed, or ready.
- Do not treat TypeScript/build success as proof that a product feature works.
- For file generation features, create or inspect a real output file and verify that it opens, has the requested structure, and is not just chat text pasted into a document.
- For UI features, verify the actual user path that triggers the behavior, not only the component or API in isolation.
- For router/planner/tool changes, verify that the request enters the intended pipeline and does not fall back to old chat logic.
- In the final response, report what was actually verified. If only code-level checks were run, say that clearly.

## Architecture Invariants

1. One business decision has one authoritative owner. Downstream modules must not reinterpret a decision already made upstream.
2. Do not add a parallel route, content model, renderer, or retry path without replacing an existing path or defining a migration and deletion condition.
3. AI owns semantic content. Programs own internal IDs, state, template versions, numbering, storage, and rendering rules.
4. Renderers format approved content. They must not infer user intent, select templates, generate missing content, or rewrite document meaning.
5. Small fixes may be implemented directly. Changes that add a parallel flow, modify a core data model, or move responsibility between modules require an impact analysis first.
6. Product behavior changes, deletion of user-facing compatibility paths, database migrations, and production deployment require explicit user authorization.

## Grant Platform

The NSFC grant collaboration platform is an isolated bounded context. Before
changing `app/grants/`, `app/api/grants/`, `components/grants/`, `lib/grants/`,
or grant-related migrations, read all of the following:

- `docs/grants/ARCHITECTURE.md`
- `docs/grants/DOMAIN-CONTRACTS.md`
- `docs/grants/IMPLEMENTATION-PLAN.md`
- `docs/grants/PR-CHECKLIST.md`

Grant development must also obey these rules:

1. The canonical grant document, revisions, diagnostics, patches, evidence
   authorization, and exports each have one owner defined in the grant
   architecture. No route or UI component may reinterpret those decisions.
2. Grant code must not import chat routes or Document V2 orchestration internals.
   Shared capabilities are consumed only through explicit ports and adapters.
3. All formal-content writes use revision compare-and-swap. AI produces a
   proposal; it never writes canonical content directly.
4. Every model context is rebuilt through the grant model-data gateway using
   current evidence authorization. Cached authorization is not authoritative.
5. Uploaded documents and evidence are untrusted data. Programmatic patch-scope
   validation is mandatory even when the user accepted model output.
6. A cross-module change, new authority, temporary parallel path, or exception
   requires an impact analysis and an ADR or approved engineering exception.
7. Run `npm run check:grant-architecture` for every grant-platform change.
