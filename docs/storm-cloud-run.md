# STORM Cloud Run Shadow runtime

STORM is an optional research-exploration job. It is not a Document V2 stage,
and a STORM failure must never change, pause, retry, or block a Word job.

## Runtime flow

```text
Document task becomes durable
-> Next.js after() selects Shadow traffic
-> insert research_exploration_executions row
-> invoke one Cloud Run Job execution
-> worker claims the exact row with a fencing token
-> heartbeat during research
-> atomically publish result or structured failure
-> process exits
```

The result remains non-authoritative in Shadow mode. Document V2 does not read
it. Advisory admission is a later, separately authorized change.

## Google Cloud resources

- Artifact Registry repository: `researchgpt-runtime`
- Cloud Run Job: `researchgpt-storm-exploration`
- Runtime service account with Secret Manager access only
- Deployment identity federated from `lvjin03-commits/researchgpt`
- Four Secret Manager secrets:
  - `storm-llm-api-key`
  - `storm-search-api-key`
  - `researchgpt-supabase-url`
  - `researchgpt-supabase-service-role-key`

The GitHub deployment uses Workload Identity Federation. Do not create or
commit a Google service-account key for CI.

## Vercel server-only configuration

```text
STORM_RUNTIME_APPROVED=false
STORM_RUNTIME_MODE=off
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_RUN_REGION=
STORM_CLOUD_RUN_JOB_NAME=researchgpt-storm-exploration
GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON=
STORM_SHADOW_SAMPLE_RATE_BASIS_POINTS=10000
STORM_SHADOW_MAX_CONCURRENT=2
```

`GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` belongs only in Vercel's encrypted server
environment. The service account needs only permission to run the named job.
Rotate the key after Workload Identity Federation from Vercel is introduced.

## Admission order

1. Apply migration `029_research_exploration_runtime.sql`.
2. Deploy the Cloud Run Job with `runtime_approved=false`.
3. Verify a failed runtime-off execution is durably fenced and observable.
4. Update the admission record with the lease/recovery evidence.
5. Redeploy the Job with `runtime_approved=true`.
6. Enable Vercel `STORM_RUNTIME_MODE=shadow` for a limited sample.
7. Verify the normal DOCX completes independently and the Shadow result is saved.

Never enable Advisory or Required as part of this procedure.
