# ResearchGPT Local Connector Contract

This document defines the local connector bridge. The product experience should
feel like one ResearchGPT workspace: the web app is the main UI, and the local
connector runs quietly in the background to provide local-file capabilities.

## Product Rules

- Do not present the connector as a separate desktop product.
- User-facing copy should call it `ResearchGPT 本机连接器`.
- The web workspace remains the primary operation surface.
- The connector is only responsible for local permissions, folder selection,
  local PDF reading, local file opening, and future local export actions.
- If a capability cannot run, the UI must explain whether the connector is not
  installed, installed but unauthorized, outdated, or temporarily unavailable.

## Protocol

The local connector should register:

```text
researchgpt://connect
researchgpt://task/{taskId}
researchgpt://project/{projectId}
```

The current milestone only requires:

```text
researchgpt://connect
```

When the web app opens this URL, the connector should start in the background,
restore the signed-in ResearchGPT account when possible, and start its local
capability server.

## Status Endpoint

The connector should expose:

```text
GET http://127.0.0.1:48732/status
```

The endpoint must support CORS for the ResearchGPT web origin.

Minimum connected response:

```json
{
  "online": true,
  "app": "ResearchGPT 本机连接器",
  "version": "0.1.0",
  "userId": "user-id",
  "deviceName": "Lab Workstation",
  "authorized": true,
  "state": "connected",
  "capabilities": ["local_files", "open_pdf", "read_pdf", "local_export"]
}
```

Recommended unavailable responses:

```json
{ "online": false, "state": "disconnected", "message": "Connector is offline." }
```

```json
{ "online": true, "authorized": false, "state": "permission_required" }
```

```json
{ "online": true, "state": "version_mismatch" }
```

If the connector is not installed, the browser fetch will fail. The web app
maps that to `not_installed` after attempting to wake the connector.

## Local Folder Binding

The connector exposes a user-triggered folder picker:

```text
POST http://127.0.0.1:48732/local-folders/select
```

This endpoint opens the native folder picker, scans the selected folder for PDF
files, and returns file metadata to the web workspace. It does not upload,
parse, or analyze the PDFs.

Minimum response:

```json
{
  "canceled": false,
  "folder": {
    "id": "local-folder-id",
    "name": "Organic catalysis",
    "path": "C:\\Users\\name\\Papers\\Organic catalysis",
    "boundAt": "2026-07-20T12:00:00.000Z",
    "pdfCount": 12,
    "truncated": false,
    "files": [
      {
        "id": "local-file-id",
        "name": "paper.pdf",
        "path": "C:\\Users\\name\\Papers\\Organic catalysis\\paper.pdf",
        "size": 1234567,
        "modifiedAt": "2026-07-20T12:00:00.000Z"
      }
    ]
  }
}
```

## Local PDF Actions

The connector exposes file-level actions for PDFs discovered through bound
local folders:

```text
POST http://127.0.0.1:48732/local-files/open
POST http://127.0.0.1:48732/local-files/read
```

Request body:

```json
{
  "path": "C:\\Users\\name\\Papers\\Organic catalysis\\paper.pdf"
}
```

`/local-files/open` opens the file with the user's default PDF reader.

`/local-files/read` extracts text locally and returns a bounded preview:

```json
{
  "filePath": "C:\\Users\\name\\Papers\\Organic catalysis\\paper.pdf",
  "name": "paper.pdf",
  "pageCount": 12,
  "text": "extracted text...",
  "charCount": 42000,
  "truncated": false
}
```

## Acceptance

1. Open the web app.
2. If the connector is installed and authorized, the web UI shows
   `本机连接器已连接`.
3. If the connector is installed but unauthorized, the web UI shows an
   authorization prompt.
4. If the connector is not installed, the web UI shows an installation guide
   link instead of a generic failure.
5. After authorization, binding a local folder opens the native folder picker.
6. The selected folder is attached to the current project without changing the
   file's original path on the user's computer.
