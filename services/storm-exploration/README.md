# STORM exploration service

This isolated service exposes only STORM research and outline candidates. It does not generate articles, mutate Document V2, or publish evidence directly.

The API queues work in SQLite. A separate worker claims one execution and publishes a versioned result. The HTTP process never runs STORM in a background task.

The official `knowledge-storm` 1.1.1 wheel is transformed by a reproducible,
hash-verified safety builder into the scoped
`1.1.1+researchgpt.4` research-and-outline runtime. The derivative removes
persistent model caches, Co-STORM eager loading, and unused local ML/vector
dependencies. Its Python 3.11/Linux dependency set is hash-locked, has a
license inventory, and passed the isolated Linux image smoke test. The runtime
remains `blocked` because the credentialed provider canary and production
execution store are not admitted yet.
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

The repository also contains `STORM image smoke`, an isolated GitHub Actions
workflow that builds the Linux image and verifies the non-root user, health
check, runtime-off admission gate, writable data volume, and absence of the
removed cache/local-ML dependencies. It uses no provider credentials and does
not publish or deploy the image.

The credentialed provider canary is a separate, default-deny command. It is
fixed to one perspective, one question, at most eight model calls, two search
queries, and a three-minute Linux wall-time. It records provider request IDs,
tokens, estimated cost, and call outcome without storing prompts or API keys,
and writes only a non-authoritative report:

```text
docker run --rm --env-file <private-canary-env> researchgpt-storm-canary \
  python -m tools.run_provider_canary --report /data/canary-report.json
```

The private environment must explicitly set `STORM_CANARY_APPROVED=true`.
`STORM_RUNTIME_APPROVED` remains false; the canary cannot publish into Document
V2 or activate the service runtime.

For shared verification, manually run the `STORM provider canary` GitHub
Actions workflow after configuring the protected `storm-canary` Environment
with `STORM_LLM_API_KEY` and `STORM_SEARCH_API_KEY`. The workflow never runs on
push, never publishes its image, and retains the non-authoritative evidence
artifact for 14 days.

Use `runtime.env.example` only as a field list. Never commit populated secrets,
and keep `STORM_RUNTIME_APPROVED=false` until the admission record is approved.
