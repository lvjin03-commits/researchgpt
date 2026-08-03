# STORM exploration service

This isolated service exposes only STORM research and outline candidates. It does not generate articles, mutate Document V2, or publish evidence directly.

The API queues work in SQLite. A separate worker claims one execution and publishes a versioned result. The HTTP process never runs STORM in a background task.

The real `knowledge-storm` runtime is intentionally absent. The current 1.1.1
candidate is recorded in `runtime-admission.json` with status `blocked` because
its mandatory dependency graph has an unresolved vulnerability and cannot yet
produce an admitted reproducible lock. Production startup requires both an
approved admission record and `STORM_RUNTIME_APPROVED=true`; the environment
variable alone cannot enable it. Tests use a deterministic fake runner.

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
