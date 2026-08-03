# STORM exploration service

This isolated service exposes only STORM research and outline candidates. It does not generate articles, mutate Document V2, or publish evidence directly.

The API queues work in SQLite. A separate worker claims one execution and publishes a versioned result. The HTTP process never runs STORM in a background task.

The real `knowledge-storm` runtime is intentionally absent. The audited v1.1.0 dependency set contains known vulnerabilities, so production startup remains gated by `STORM_RUNTIME_APPROVED=true` and a later provider-configuration step. Tests use a deterministic fake runner.

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
