# ResearchGPT Point Billing Domain Contracts

## Commercial Baseline

The initial commercial configuration is:

```text
100 points = CNY 1.00 of ResearchGPT AI usage credit
standard markup = 50% over frozen provider/tool cost
launch bonus = 13% of purchased points, rounded down to a whole point
```

The 13% bonus is a versioned campaign, not a permanent property of points. A
price or campaign change creates a new policy version and does not rewrite
historical grants or charges.

Users may request any positive whole number of points within server-owned
payment and risk limits. The server derives the payable amount; the browser
cannot submit an authoritative amount, bonus or exchange rule.

`智点` is a site-wide settlement unit, not a fixed token conversion. Public
copy must not claim that one point always equals a fixed number of model tokens.

## Balance Sources

Purchased, purchase-bonus and promotional trial points are distinct sources:

```ts
type PointGrantKind = "purchased" | "purchase_bonus" | "promotional_trial";

type PointLot = {
  lotId: string;
  accountId: string;
  grantKind: PointGrantKind;
  pointsGranted: bigint;
  pointsRemaining: bigint;
  paymentOrderId: string | null;
  campaignId: string | null;
  grantReason: string;
  policyVersion: string;
  expiresAt: string | null;
  createdAt: string;
};
```

Every payment-funded grant remains linked to its payment order even though the
product does not expose self-service refunds. This provenance is required for
duplicate-payment correction, provider reversal, dispute handling, expiry,
audit and reconciliation.

Purchased points and bonus points must never be merged into one untraceable
grant. Consumption order is deterministic and versioned. Expiring promotional
points may be consumed first; the exact production order is frozen before the
ledger implementation begins.

## Payment and Grant Boundary

A browser success page is not proof of payment. Points are granted only after:

```text
verified provider event
+ matching merchant/order/amount/currency
+ idempotency check
+ payment state transition
+ point-lot and ledger writes
= one committed database transaction
```

Repeated provider notifications cannot grant points twice. Returning to a
pending AI operation is permitted only after the server reports that the point
grant transaction committed.

The initial purchase policy maps one whole point to one CNY minor unit and
calculates the versioned launch bonus on the server. A verified successful
event must match the frozen provider, merchant account, provider order, amount
and currency. Accepting that event, changing the order to paid and granting the
separate purchased/bonus lots is one database transaction. Provider adapters
cannot call the generic lot-grant RPC directly.

## Usage Pricing

Feature modules report standardized factual usage. The Price Catalog freezes
the provider/tool price and markup policy for one billing operation.

```ts
type StandardizedBillableUsage =
  | {
      kind: "tokens";
      inputTokens: bigint;
      cachedInputTokens: bigint;
      outputTokens: bigint;
      reasoningTokens: bigint;
    }
  | { kind: "tool_call"; tool: string; count: bigint }
  | { kind: "image_input"; units: bigint; detail: string }
  | {
      kind: "image_generation";
      count: bigint;
      size: string;
      quality: string;
    }
  | { kind: "audio"; durationMilliseconds: bigint }
  | { kind: "video"; durationMilliseconds: bigint; resolution: string };
```

The catalog, not a feature module, calculates:

```text
provider/tool cost under frozen price policy
  * (1 + frozen markup rate)
  -> integer point charge under the frozen rounding rule
```

Currency conversion, provider price, tool price, markup and rounding inputs are
stored in the immutable settlement snapshot. They need not be exposed as
public operational configuration, but user-visible estimates and final point
charges must remain explainable.

The site-wide AI Operation Registry is the only source of executable billing
operation IDs. Price policies may reference its derived type only; a missing
operation/price binding fails closed and cannot use a default price.

## Edit Session Billing Subject

An Edit Session has no predetermined turn count and therefore is never one
open-ended reservation. Each explicit `grant.edit_session.turn` is one bounded
future billing Bundle. Its existing `turnId` is also its at-most-once
`billingOperationId`.

Session creation, session/history reads, Candidate listing, deterministic Diff
reads, Candidate application and session discard are non-billable. Applying a
Candidate cannot charge again for the model work that created it. Every later
continue-edit instruction creates a new turn and a new independent reservation.

## Deliverability and Charging

The invariant is:

```text
provider incurred cost != user charge
```

An Operation can settle only output that is programmatically validated,
persisted where required, still applicable under current document and
authorization state, and made available to the user. Unknown terminal states
are non-billable and alert operators. Models cannot declare a result billable.

Platform retries, controlled output repairs, rejected structured output,
provider errors, stale results, authorization-invalid results and cache hits
do not create an additional user charge. Detailed per-Operation deliverability
matrices and Bundle rules are frozen in implementation step four before any
real charging path is enabled.

Implementation step four freezes these accepted terminal states:

```text
delivered | partially_delivered | succeeded_internal_only
structured_output_invalid | structured_reference_invalid | output_truncated
content_filtered | provider_refusal | provider_rate_limited | provider_timeout
provider_transient_error | provider_unavailable | stale_completed
unable_to_reverify | ambiguous_match | blocked
```

Only delivered output is chargeable. A partially delivered aggregate is
settled by finalizing each delivered Bundle separately; the aggregate state is
never itself charged as one undifferentiated result. Every other listed state
releases. A future unknown state also releases and emits an operator alert.

## Exact Price Arithmetic

Settlement uses integer micro-USD, integer micro-CNY, integer basis points and
whole points. It does not use binary floating-point money. A policy freezes:

- provider and model;
- input, cached-input, output and tool/media rates;
- internal currency-conversion snapshot;
- markup basis points;
- whole-point rounding rule;
- effective interval and immutable policy version.

Provider `reasoningTokens` are an informational subset of total output tokens
in the current usage contract. They are retained for audit and capacity
analysis but are not priced again after total output, preventing double charge.

A quote contains expected low/high and maximum charge for every Bundle and the
whole operation. The confirmation rule initially triggers when the expected
high is at least 500 points or the maximum charge is at least 50% of available
balance. The UI must display both the likely range and hard maximum.

The price policy version freezes when points are reserved. Actual charge is the
lower of calculated delivered usage and the user-confirmed maximum. Provider
cost above that maximum, including platform repair/retry cost, is absorbed by
ResearchGPT.

## Reservation and Ledger Invariants

Balances use integer points. Balance mutation is a database-atomic operation,
never an application-level read-then-write sequence.

Every mutation is append-only and identified by a globally unique billing
operation/event identity. Duplicate reservation, settlement, release, payment
grant or reversal events have no second effect.

The ledger must guarantee:

- available and reserved balances never become negative;
- settlement cannot exceed the user-confirmed maximum charge;
- platform retry cost cannot increase that maximum;
- unused reservation is released;
- multi-stage work reserves and settles versioned Bundle slices;
- an unknown state releases rather than silently charges;
- historical entries are corrected by compensating entries, not deletion or
  in-place rewriting.

## Reversal and Risk Boundary

The product does not expose a self-service refund flow in the initial phase.
This is a product-scope decision, not a legal conclusion that refunds can never
be required.

Verified payment-provider reversals and chargebacks are mandatory payment
events, not optional administrator decisions. They create compensating ledger
entries automatically. Point balances stop at zero; an unrecovered amount is a
separate risk shortfall and may place the account on a review hold. It does not
silently create a negative wallet or rewrite historical consumption.

The verified reversal transaction revokes both the purchase-bonus and
purchased lots linked to the payment order. It recovers only remaining points;
already consumed value becomes a recovery shortfall. Duplicate events are
idempotent, and a shortfall deterministically places the account on
`risk_hold`. Payment adapters cannot choose whether the event is enforced.

Checkout risk runs before a pending order is persisted. Its inputs are opaque
hashes rather than raw network, device or payment identifiers. One versioned
program policy owns single-purchase, account, device, network-velocity and
payment-method/account limits. Risk decisions cannot grant or deduct points.

The external refund, purchased-point expiry and consumer-rights wording remain
blocked on professional legal review. Product copy must preserve applicable
legal and payment-channel rights and cannot state an unconditional no-refund
rule before that review is accepted.

## Initial Non-goals

The governance step does not implement:

- a point wallet or database migration;
- a payment provider;
- a user checkout or refund screen;
- real point deduction;
- a private Grant billing path;
- image-generation pricing;
- an emergency unmetered AI fallback;
- final legal terms.

## Existing Feature Metering Boundary

Existing AI features may project factual provider usage into the shared
`ai_usage_events` stream without acquiring price or balance authority. Chat
task kinds map to the shared Operation Registry; Document V2 and Grant retain
their existing execution logs and additionally report the same factual call in
the standardized envelope.

Meter-only projection is explicitly non-financial. It must not reserve, settle
or release points. Runtime charging cannot be inferred from the presence of a
usage row and cannot be enabled by an unrecognized environment value.

## Statements, Reconciliation and Canary

A user statement is a read-only, owner-scoped projection of committed Point
Ledger transactions. It displays grants, reservations, settlements, releases
and reversals with frozen Operation/price/payment references where available.
It cannot infer balance from AI telemetry or modify history.

Reconciliation compares provider settlement records in both directions and
checks internal payment, lot, available-balance and reserved-balance
invariants. Findings are alerts, not mutation commands. Corrective action must
use an existing idempotent event path or a reviewed compensating mechanism.

Initial charged rollout has no unrestricted mode. A canary requires explicit
owner and Operation allowlists, expiry, daily ceiling, active funded account,
price policy and pre-dispatch reservation. Nonmembers remain meter-only.
Single-Bundle failures release; unknown settlement persistence preserves the
reservation for reconciliation instead of guessing an outcome.
