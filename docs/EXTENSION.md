# ResearchAI Chrome Extension

Manifest V3 extension for downloading Google Scholar PDFs in Chrome and saving them into the ResearchAI literature library.

## Location

`extensions/google-scholar/`

## Architecture

```
Google Scholar page
  └─ content.js
       ├─ parses visible result DOM on user click
       ├─ chrome.runtime.sendMessage({ type: "GET_FOLDERS" })
       ├─ shows an in-page folder picker
       └─ chrome.runtime.sendMessage({ type: "SAVE_PAPER", paper, folderIds })
            └─ background.js (service worker)
                 └─ POST /api/extension/save-paper
                      Authorization: Bearer <token>
```

The extension does **not** scrape in the background. It only reads the DOM for a result the user explicitly clicks **Save PDF to ResearchGPT** on.

If a result has no direct PDF link, the extension does not save a paper record. It shows a "No PDF link" message instead. A save only succeeds after Chrome downloads the PDF, the extension uploads that PDF, and the backend stores it with the selected folder assignment. If the source site blocks automatic PDF download, the extension opens the PDF page so the user can download it manually and upload it from the ResearchGPT literature library.

## Backend API

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/extension/save-paper` | POST | Bearer token or cookie | Save one paper |
| `/api/extension/upload-paper` | POST multipart/form-data | Bearer token or cookie | Upload one Chrome-downloaded PDF and save one paper |
| `/api/extension/folders` | GET | Bearer token or cookie | List user folders |
| `/api/extension/session` | GET | Cookie session | Issue JWT for extension connect |

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

Papers are upserted with `providers: ["google_scholar"]`, marked `saved`, archived from the uploaded PDF file, and assigned to the folders selected in the in-page picker. The extension should prefer `/api/extension/upload-paper`; `/api/extension/save-paper` is only a server-side PDF download fallback.

## Auth

ResearchGPT uses **Supabase Auth via `@supabase/ssr`**. The web app stores the session in **HTTP cookies**, not Local Storage. You will not find `sb-*-auth-token` or `supabase.auth.token` under Application → Local Storage.

The extension stores the JWT in `chrome.storage.local` under `researchAiAuthToken` and sends it as `Authorization: Bearer <token>`.

### How to connect

1. Sign in to ResearchGPT in Chrome (same browser profile as the extension).
2. Open the extension popup.
3. Set **ResearchAI URL** to `https://researchgpt-ivory.vercel.app`.
4. Click **Connect account**.

The popup calls `GET /api/extension/session` with `credentials: include`, reads the cookie session on the server, and returns `{ accessToken, expiresAt }`.

If you are not signed in, the extension opens `/auth?next=/extension/connect`. After login, `/extension/connect` shows the token and the connect-bridge content script saves it to the extension automatically.

Manual fallback: open `/extension/connect` while signed in and copy the access token into the popup.

The backend validates Bearer tokens via `supabase.auth.getUser(token)`.

Cookie-based session auth still works for extension routes when the request includes session cookies (same-origin browser requests).

## Install locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extensions/google-scholar`

## Configure

1. Open the extension popup.
2. Set **ResearchAI URL** to `https://researchgpt-ivory.vercel.app`.
3. Click **Connect account** (sign in first if prompted).
4. Click **Load folders** to confirm the extension can read your folders.

## Use on Google Scholar

1. Search on [Google Scholar](https://scholar.google.com/).
2. Each result shows a **Save PDF to ResearchGPT** link.
3. Click it to open the folder picker.
4. Select one or more folders, then click **Save PDF**. Chrome downloads the PDF, then the extension uploads and saves the PDF file plus paper metadata to those folders.
5. If the source site blocks automatic PDF download, the extension opens the PDF page and asks the user to download the PDF manually, then upload it from the ResearchGPT literature library.
6. If the result has no direct PDF link, the extension shows **No PDF link** and does not save anything.
7. Open the popup to see the latest save status.

## CORS

Extension requests from `chrome-extension://` origins are allowed by `lib/http/extension-cors.ts` with `Authorization` header support.

## Related code

| Path | Role |
|---|---|
| `extensions/google-scholar/` | Extension source |
| `app/api/extension/session/route.ts` | Cookie session → JWT for extension |
| `app/extension/connect/page.tsx` | Connect page + manual token copy |
| `app/api/extension/folders/route.ts` | Folder list for popup |
| `app/api/extension/upload-paper/route.ts` | Extension PDF upload save endpoint |
| `lib/literature/server/extension-auth.ts` | Bearer + cookie auth |
| `lib/literature/server/extension-paper.ts` | Parse + upsert shared logic |
| `lib/supabase/bearer-client.ts` | Supabase client from JWT |

## Development rules

- Do not add background scraping or batch crawling.
- Keep DOM parsing in the content script; keep network calls in the service worker.
- Reuse `parseExtensionScholarPaper` / `saveExtensionPaper` for any new extension import paths.
