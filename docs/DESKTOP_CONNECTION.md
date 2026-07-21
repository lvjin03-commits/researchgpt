# ResearchGPT Desktop Connection Contract

This document defines the first desktop/web bridge. The goal is one
ResearchGPT workspace across web and desktop, not two separate products.

## Protocol

The desktop app should register this protocol:

```text
researchgpt://connect
researchgpt://task/{taskId}
researchgpt://project/{projectId}
```

The first milestone only requires:

```text
researchgpt://connect
```

When the web app opens this URL, the desktop app should start or focus itself,
restore the signed-in ResearchGPT account, and start its local capability
server.

## Local Status Endpoint

The desktop app should expose:

```text
GET http://127.0.0.1:48732/status
```

The endpoint must support CORS for the ResearchGPT web origin.

Minimum response:

```json
{
  "online": true,
  "app": "ResearchGPT Desktop",
  "version": "0.1.0",
  "userId": "user-id",
  "deviceName": "Lab Workstation",
  "capabilities": ["local_files", "open_pdf", "local_export"]
}
```

## Local Folder Binding

The desktop app also exposes a user-triggered folder picker:

```text
POST http://127.0.0.1:48732/local-folders/select
```

This endpoint opens the native folder picker, scans the selected folder for
PDF files, and returns file metadata to the web workspace. It does not upload,
parse, or analyze the PDFs yet.

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

## Required Behavior

- Every visible desktop capability must be real and actionable.
- If a capability cannot run, the desktop app must return a clear reason.
- Web and desktop should show the same projects, tasks, files, and artifacts.
- The execution location can differ, but the workspace must feel unified.

## First Milestone Acceptance

1. Open the web app.
2. Click "连接本机能力".
3. The browser opens `researchgpt://connect`.
4. ResearchGPT Desktop starts.
5. The desktop app exposes `/status`.
6. The web app changes to "本机能力已连接".
## Second Milestone Acceptance

1. Open or create a research project in the chat workspace.
2. Click "绑定本地文件夹".
3. ResearchGPT Desktop opens the system folder picker.
4. The selected folder is saved to the current project.
5. The chat header shows the bound local folder count and PDF count.
