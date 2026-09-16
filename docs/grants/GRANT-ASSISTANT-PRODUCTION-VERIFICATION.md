# Grant Assistant production verification

This runbook is intentionally not executed by ordinary offline development.

## Preconditions

1. All Grant CI and type checks pass for the exact commit to deploy.
2. Migration 076 is applied before the application release.
3. The production deployment contains the same commit.
4. A user explicitly authorizes one paid OpenAI verification request.
5. Record the document ID, turn ID and expected Revision without copying document content into logs.

## Authorized verification turn

Submit one whole-document review question against a non-sensitive verification document. Do not
repeat the request while its execution lease is active.

## Required evidence

Verify all of the following using the returned trace ID:

- one Grant Assistant execution exists and is `completed`;
- its Revision, input hash, model and policy match the submitted turn;
- every dispatched provider request ID appears once in `grant_model_calls`;
- model-call token totals equal the standardized usage event keyed by the model-call ID;
- the saved assistant message and execution checkpoint report the same context coverage;
- a complete result reports `synthesisComplete=true`;
- a partial result reports `complete=false`, covered/total units, `synthesisComplete=false` and a
  safe `partialReasonCode`;
- refreshing the page restores the answer without another provider request;
- resubmitting the same turn is rejected and does not create another usage event.

## Stop conditions

Stop verification and do not retry automatically if migration 076 is absent, usage totals disagree,
coverage changes after refresh, the execution lease is still active, or the trace reports a
persistence failure. Preserve the trace ID and inspect the owner-visible diagnostic projection.
