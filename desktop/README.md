# ResearchGPT Local Connector MVP

This is the first local connector for the unified ResearchGPT workspace.

It intentionally runs as a background capability bridge. Users should keep
working in the web UI; the connector should only appear when the operating
system needs an explicit user action such as choosing a local folder.

It does four things:

1. Registers the `researchgpt://connect` protocol.
2. Exposes `GET http://127.0.0.1:48732/status` so the web app can detect local capabilities.
3. Opens the native folder picker when the web app asks the user to bind a local folder.
4. Opens or reads local PDFs only after the user has bound the folder.

By default it does not show the ResearchGPT workspace window. For debugging,
set `RESEARCHGPT_SHOW_CONNECTOR_WINDOW=true`.

Run:

```bash
npm run desktop
```

For local web development:

```bash
set RESEARCHGPT_DESKTOP_URL=http://localhost:3000/chat
npm run desktop
```

For debugging with a visible connector window:

```bash
set RESEARCHGPT_SHOW_CONNECTOR_WINDOW=true
npm run desktop
```
