# STORM exploration service

This isolated service exposes only STORM research and outline candidates. It does not generate articles, mutate Document V2, or publish evidence directly.

The local API queues work in SQLite. Production Cloud Run Jobs use the durable
Supabase execution store, claim one explicit execution with a fencing token,
renew the lease while STORM runs, publish the versioned result atomically, and
exit. The HTTP process never runs STORM in a background task.

The official `knowledge-storm` 1.1.1 wheel is transformed by a reproducible,
hash-verified safety builder into the scoped
`1.1.1+researchgpt.4` research-and-outline runtime. The derivative removes
persistent model caches, Co-STORM eager loading, and unused local ML/vector
dependencies. Its Python 3.11/Linux dependency set is hash-locked, has a
license inventory, and passed the isolated Linux image smoke test. The
production Supabase lease/recovery drill and the credentialed DeepSeek + Tavily
provider canary have passed and are recorded in `runtime-admission.json`. The
runtime is admitted only for the isolated, cost-capped Proposal canary. Vercel
and Document V2 remain disconnected until a separately authorized Shadow
rollout.
Production startup requires both an approved admission record and
`STORM_RUNTIME_APPROVED=true`; the environment variable alone cannot enable it.
Tests continue to use a deterministic fake runner.

The same image can be deployed as an on-demand Cloud Run Job by overriding the
command to `python -m app.run_worker`. Provider and Supabase credentials must be
mounted from Google Secret Manager. `STORM_EXECUTION_ID` is supplied only as an
execution override and is never frozen into the Job template.

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
fixed to one generated perspective plus STORM's default perspective, one question
per perspective, ten logical model calls with a hard ceiling of thirty physical
provider calls for DSPy field-completion recovery, two search
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
