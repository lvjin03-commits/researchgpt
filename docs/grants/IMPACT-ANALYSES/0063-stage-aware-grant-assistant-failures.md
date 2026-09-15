# Impact analysis: Stage-aware Grant Assistant failures

## Change

Failure presentation becomes one application-level decision instead of nested
conditionals in the API. Hierarchical full-review execution now preserves prior
unit request IDs and usage when a later unit fails. The browser displays the
server trace ID alongside the already-safe user message.

## Authorities

- Model adapters classify provider facts and attach provider metadata.
- Context Budget Planner classifies pre-dispatch capacity rejection.
- Grant Model Executor owns durable attempt state and final trace identity.
- Grant Model Failure Presenter owns HTTP/user presentation only; it cannot
  reclassify the recorded failure.
- Billing continues to use recorded factual usage and dispatch state.

## Data and Privacy

No prompt, original text, diagnostic text or generated answer is added to model
call telemetry. Only existing identifiers, hashes, category, stage, booleans and
token counts are retained. Trace IDs are safe to expose to the owning user.

## Risks and Controls

- Incorrect retry advice is prevented by a tested category-to-presentation map.
- A partial hierarchical run cannot report zero usage when known earlier usage
  exists.
- Unknown categories still receive a generic incomplete-processing message,
  never a false claim that OpenAI is down.
- Production behavior is not claimed until a signed-in deployed user path is
  verified.

## Rollout

No schema change is required beyond pending migration 073 from Step 1. Deploy
only with the existing Step 1–3 bundle after explicit authorization. Rollback
reverts the presenter and aggregation code without changing stored attempts.
