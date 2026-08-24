# Impact Analysis 0004: Existing AI Feature Integration

## Decision

Step five connects existing AI execution paths to one standardized factual
usage event stream. It does not enable point deduction.

The integration has two initial modes:

- `disabled`: no new billing-grade usage event is written;
- `meter_only`: usage is recorded, but no quote, reservation or settlement is
  attempted.

An `enforced` mode is deliberately not accepted by the runtime parser in this
step. It requires applied migrations, active price policies, funded accounts,
checkout, user-visible estimates and the step-eight canary authorization.

## Existing Owners and Effects

| Area | Existing owner | Step-five effect |
|---|---|---|
| Chat routing | Chat task router | Its existing task kind maps to the shared Operation Registry; routing is unchanged |
| Chat usage | `recordAiUsage` | Writes the existing monitoring columns plus immutable standardized identity and usage facts |
| Document V2 execution | Document text executor/worker | The existing successful provider-call callback also reports standardized usage |
| Grant assistant/edit execution | Grant Model Executor | Successful attempts report standardized usage after the existing model-call record commits |
| Grant diagnostics | Grant diagnostic execution/persistence | No charging integration yet; its multi-Bundle delivery boundary must be wired as one unit, not inferred per low-level call |
| Price and balance | Point Billing Service | Unchanged and not invoked in meter-only mode |

## No Parallel Authority

`ai_usage_events` is a factual metering/audit stream. It cannot calculate
prices, decide deliverability, reserve points or mutate balances.
`grant_model_calls` and Document events remain their bounded-context diagnostic
logs and may reference the same factual call; they do not become billing
authorities.

## Failure Policy

In `meter_only`, failure to append the cross-site usage projection is logged and
does not turn an already delivered AI result into a product failure. The
bounded-context call log remains authoritative for operational diagnosis.
Before `enforced` charging is introduced, the append path must become part of a
database-atomic reservation/finalization flow or a durable outbox; best-effort
metering is never sufficient for money movement.

## Scope and Deferred Work

This step covers existing successful text model calls for Chat, Document V2,
Grant assistant chat and Grant Edit Turns. Chat tool counters are preserved as
standardized tool-call usage. Image generation and other non-token assets stay
deferred until their provider usage units are authoritative.

Grant semantic diagnosis is explicitly deferred from per-call charging. Its
Fact Map is internal, while scientific and narrative review are separate
delivery Bundles; wiring it at the low-level model adapter would violate the
deliverability contract.

## Removal / Rollback

Set `AI_POINT_BILLING_MODE=disabled` to stop the new cross-site projection.
Existing feature behavior and existing operational usage logs remain intact.
Migration 061 is additive and does not reinterpret historical rows.
