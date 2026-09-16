# ADR 0069: meter every dispatched Grant model attempt with known usage

## Status

Accepted for implementation; production paid-provider verification requires separate authorization.

## Decision

Use the durable Grant model-call ID as the standardized usage-event ID. Emit factual token usage for
both successful and failed provider-dispatched attempts when usage is known. Never emit provider
usage for failures that occur before dispatch. Persist safe partial-delivery coverage and reason
metadata beside the resumable result.

The model-call ledger remains the primary attempt audit. The shared usage stream remains the billing
projection. Their common call ID makes reconciliation deterministic and prevents duplicate charging.

## Consequences

- Provider costs are no longer omitted merely because the model result was unusable.
- Retried attempts produce separate usage events because they are separate paid requests.
- Resumed checkpointed units and reductions do not emit new usage because no provider request occurs.
- A partial answer is auditable as partial, including covered units, total units, synthesis status and
  the safe reason that stopped final completion.
- The change does not decide how many 智点 a token costs; pricing remains owned by the billing policy.

## Rejected alternatives

- Meter only successful answers: hides real provider cost.
- Reuse the turn ID as every attempt's event ID: collapses distinct paid retries.
- Charge local capacity failures: no provider work occurred.
- Store raw provider errors for debugging: violates the safe telemetry boundary.
