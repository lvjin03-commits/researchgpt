# Impact Analysis 0006: Automated Reversal and Checkout Risk

## Decision

Verified provider reversals and chargebacks are mandatory financial events.
They automatically create compensating Point Ledger entries; no administrator
approval sits between verified money removal and ledger correction.

Checkout risk is a separate deterministic service. It can allow or deny order
creation, but it cannot verify payments, calculate bonuses, grant points or
change balances.

## Reversal Rules

- Provider, merchant, provider order, amount and currency must match the paid
  order exactly.
- Reversal event IDs are idempotent and rechecked after the order row lock.
- The purchase-bonus lot is reversed before the purchased lot, but both belong
  to one database transaction.
- Each lot is reversed for its original grant size. Remaining points are
  recovered; already consumed points become an append-only recovery shortfall.
- Available balance stops at zero. Any shortfall places the account on
  `risk_hold`, which the existing reservation authority already rejects.
- The payment order becomes `reversed`; history is not deleted or rewritten.

## Risk Inputs and Privacy

The application supplies only SHA-256-style opaque hashes for device, network
and provider payment-method identity. Raw IP addresses, device fingerprints,
card numbers and bank identifiers are forbidden in the billing tables.

The versioned initial policy supports:

- maximum single purchase;
- account rolling 24-hour amount;
- device rolling 24-hour amount;
- network rolling one-hour order velocity;
- distinct accounts per payment method over 24 hours.

The database serializes all dimensions with transaction advisory locks before
counting, preventing simultaneous requests from bypassing a limit. Denials are
recorded for audit and velocity calculation but create no payment order.

## Deployment Boundary

No production risk values, hashing secrets, real provider adapter or checkout
route are configured. Hash retention and public privacy wording require the
approved privacy/legal policy before live payment. Migration 063 is additive
and remains unapplied.
