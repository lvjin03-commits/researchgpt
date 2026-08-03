# STORM exploration service

This isolated service exposes only STORM research and outline candidates. It does not generate articles, mutate Document V2, or publish evidence directly.

The API queues work in SQLite. A separate worker claims one execution and publishes a versioned result. The HTTP process never runs STORM in a background task.

The official `knowledge-storm` 1.1.1 wheel is transformed by a reproducible,
hash-verified safety builder into the scoped
`1.1.1+researchgpt.4` research-and-outline runtime. The derivative removes
persistent model caches, Co-STORM eager loading, and unused local ML/vector
dependencies. Its Python 3.11/Linux dependency set is hash-locked and has a
license inventory. The runtime remains `blocked` because the Linux image,
credentialed provider canary, and production execution store are not admitted yet.
Production startup requires both an approved admission record and
`STORM_RUNTIME_APPROVED=true`; the environment variable alone cannot enable it.
Tests continue to use a deterministic fake runner.

This step is an executable integration boundary, not a deployable STORM runtime. It intentionally does not contain provider credentials, a production process supervisor, or a Document V2 integration.

Endpoints:

- `POST /v1/explorations`
- `GET /v1/explorations/{remoteExecutionId}`
- `POST /v1/explorations/{remoteExecutionId}/cancel`
- `GET /v1/explorations/{remoteExecutionId}/result`
- `GET /health`

Local verification:

```text
.venv\Scripts\python.exe -m pytest tests -q
```

Provider wiring preflight (constructs the real runner but makes no external
calls):

```text
python -m tools.verify_provider_wiring
```

The Linux image is built from the exact upstream wheel and the committed hash
lock:

```text
docker build -t researchgpt-storm-canary .
```

Use `runtime.env.example` only as a field list. Never commit populated secrets,
and keep `STORM_RUNTIME_APPROVED=false` until the admission record is approved.
