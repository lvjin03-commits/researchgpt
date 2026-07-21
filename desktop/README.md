# ResearchGPT Desktop MVP

This is the first desktop shell for the unified ResearchGPT workspace.

It intentionally does only three things:

1. Opens the same ResearchGPT web workspace in a desktop window.
2. Registers the `researchgpt://connect` protocol.
3. Exposes `GET http://127.0.0.1:48732/status` so the web app can detect local capabilities.

Run:

```bash
npm run desktop
```

For local web development:

```bash
set RESEARCHGPT_DESKTOP_URL=http://localhost:3000/chat
npm run desktop
```

The desktop app is not yet responsible for local PDF scanning, Office/WPS control,
or local task execution. Those capabilities will be layered behind this connection
contract.
