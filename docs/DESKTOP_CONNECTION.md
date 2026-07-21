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

