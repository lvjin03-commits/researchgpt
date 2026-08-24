# Impact Analysis 0003: Price and Deliverability Engine

## Problem and Evidence

- Raw provider usage cannot decide whether a user received a chargeable result.
- Floating-point currency calculations can drift across estimates and final
  settlement.
- Multi-stage diagnostics require all Bundle ceilings to be reserved together,
  then settled or released independently.
- Reasoning tokens in current OpenAI usage are a subset of total output tokens;
  charging both would double-charge the same output.
- Unknown future terminal states must not silently become chargeable.

## Ownership

- Versioned Price Catalog owns provider/tool rates, currency conversion, markup
  and rounding inputs.
- Point Billing Service owns quotes, maximum user charge and orchestration of
  reservations and finalization.
- Operation billing contracts own exhaustive deliverability matrices and
  Bundle definitions.
- Point Ledger remains the sole balance mutation authority.
- Feature modules provide expected/actual usage and program terminal state;
  they cannot calculate points or select a billing decision.

## Chosen Approach

- Prices use integer micro-USD, integer micro-CNY, basis points and whole-point
  ceiling; no floating-point money enters settlement.
- Input, cached input and total output have independent rates. Reasoning tokens
  are retained for audit but are not charged a second time.
- Every registered Operation has all accepted terminal states mapped. Unknown
  states release the reservation and emit an observable unknown-state event.
- A quote exposes expected low/high and a hard maximum per Bundle and overall.
- Price policy version freezes at reservation; later catalog changes cannot
  reprice running work.
- Multi-Bundle reservations use one database transaction. Each Bundle later
  settles or releases independently.
- Actual calculated cost above the user-confirmed maximum is absorbed by the
  platform and never added to the user charge.

## Compatibility and Scope

- No active production price rows are seeded.
- No existing AI call invokes Point Billing Service.
- No user account is reserved or charged by this step.
- Migrations `059` and `060` remain unapplied remotely.
- Existing model routing, retries, telemetry and UI remain unchanged.

## Verification

- Exact $1/M-token fixture at CNY 7/USD and 50% markup equals 1,050 points for
  one million uncached tokens.
- Cached inputs use the cached rate.
- Reasoning cannot exceed total output and is not double-priced.
- All registered Operations have complete terminal-state matrices.
- `unable_to_reverify`, `ambiguous_match` and unknown states release.
- Two diagnostic Bundles reserve atomically.
- One delivered Bundle charges actual points and releases its difference.
- A failed second Bundle releases completely.
- Insufficient balance creates no partial Bundle reservation.
