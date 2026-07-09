# ResearchAI Chrome Extension

Manifest V3 extension for saving Google Scholar search results with direct PDF links into the ResearchAI literature library.

## Location

`extensions/google-scholar/`

## Architecture

```
Google Scholar page
  └─ content.js
       ├─ parses visible result DOM on user click
       └─ chrome.runtime.sendMessage({ type: "SAVE_PAPER", paper })
            └─ background.js (service worker)
                 └─ POST /api/extension/save-paper
                      Authorization: Bearer <token>
```

The extension does **not** scrape in the background. It only reads the DOM for a result the user explicitly clicks **Save PDF to ResearchGPT** on.

If a result has no direct PDF link, the extension does not save a paper record. It shows a "No PDF link" message instead.

## Backend API

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/extension/save-paper` | POST | Bearer token or cookie | Save one paper |
| `/api/extension/folders` | GET | Bearer token or cookie | List user folders |

### Save paper request

```json
{
  "paper": {
    "title": "Paper title",
    "url": "https://scholar.google.com/...",
    "authors": ["Author One", "Author Two"],
    "venue": "Venue / meta line",
    "year": "2024",
    "snippet": "Abstract or snippet text",
    "pdfUrl": "https://...pdf",
    "citedByCount": 42
  },
  "folderIds": ["optional-folder-uuid"]
}
```

### Save paper response

```json
{
  "saved": {
    "id": "paper-uuid",
    "title": "Paper title",
    "arxivId": "google-scholar:abc123"
  },
  "count": 1
}
```

Papers are upserted with `providers: ["google_scholar"]`, marked `saved`, and optionally assigned to default folders.

## Auth

The extension stores a Supabase access token in `chrome.storage.local` under `researchAiAuthToken`.

1. Sign in to ResearchAI in the browser.
2. Open DevTools → Application → Local Storage for your site.
3. Find the Supabase session entry and copy the `access_token` value.
4. Paste it into the extension popup.

The backend validates the token via `supabase.auth.getUser(token)`.

Cookie-based session auth still works for the legacy import route (`/api/literature/imports/google-scholar`).

## Install locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extensions/google-scholar`

## Configure

1. Open the extension popup.
2. Set **ResearchAI URL** (e.g. `http://localhost:3000` or your deployed URL).
3. Paste your **Auth token**.
4. Click **Save settings**.
5. Click **Load folders** and select default folders for saves.

## Use on Google Scholar

1. Search on [Google Scholar](https://scholar.google.com/).
2. Each result shows a **Save PDF to ResearchGPT** link.
3. Click it to save that paper only.
4. If the result has no direct PDF link, the extension shows **No PDF link** and does not save anything.
5. Open the popup to see the latest save status.

## CORS

Extension requests from `chrome-extension://` origins are allowed by `lib/http/extension-cors.ts` with `Authorization` header support.

## Related code

| Path | Role |
|---|---|
| `extensions/google-scholar/` | Extension source |
| `app/api/extension/save-paper/route.ts` | Save endpoint |
| `app/api/extension/folders/route.ts` | Folder list for popup |
| `lib/literature/server/extension-auth.ts` | Bearer + cookie auth |
| `lib/literature/server/extension-paper.ts` | Parse + upsert shared logic |
| `lib/supabase/bearer-client.ts` | Supabase client from JWT |

## Development rules

- Do not add background scraping or batch crawling.
- Keep DOM parsing in the content script; keep network calls in the service worker.
- Reuse `parseExtensionScholarPaper` / `saveExtensionPaper` for any new extension import paths.
