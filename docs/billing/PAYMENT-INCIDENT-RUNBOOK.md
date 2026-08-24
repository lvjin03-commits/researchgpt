# Payment Incident Runbook

This is the mandatory manual fallback before any real-money pilot. It does not
authorize a production payment launch.

## Roles and Response Targets

| Incident | Primary | First response | Resolution target |
|---|---|---:|---:|
| User paid, order still pending | On-call operator | 30 minutes | 4 hours |
| Duplicate provider notification | On-call operator | 30 minutes | 4 hours |
| Suspected duplicate charge | Payment owner | 30 minutes | Same business day |
| Signature/merchant mismatch spike | Security + payment owner | 15 minutes | Disable checkout immediately |
| Provider reports reversal/chargeback | Payment owner | 30 minutes | Verify automatic compensating records and risk hold |

Names, phone numbers and provider escalation contacts must be filled in before
the first live payment. An unassigned role blocks launch.

## Immediate Safety Actions

1. Disable new checkout creation with the payment capability flag. Do not
   delete orders, events, lots or ledger transactions.
2. Keep AI and existing balances readable. Do not manually edit balance columns.
3. Record incident ID, UTC time, affected owner/order IDs, provider and the
   operator taking responsibility. Never copy card data, secrets or full raw
   webhook payloads into tickets.
4. Preserve provider dashboard evidence, sanitized request IDs and database
   transaction IDs.

## Paid but Points Not Arrived

1. Ask for the ResearchGPT order ID, not card or bank credentials.
2. Read the payment order, matching sanitized provider event, purchased/bonus
   lots and grant transactions.
3. Check provider dashboard status independently. A screenshot from the user
   is supporting evidence, never payment authority.
4. If the provider shows success but no verified event exists, use the
   provider's official event redelivery mechanism. Do not fabricate a webhook
   or directly add points.
5. If a verified event exists but the transaction has no two expected lots,
   declare a transactional invariant incident, disable checkout and escalate;
   do not retry individual lot inserts manually.

## Duplicate Notification or Retry

1. Compare `(provider, providerEventId)` and the ResearchGPT order ID.
2. Confirm there is one payment transition and at most one purchased lot plus
   one bonus lot for that order.
3. Re-delivering the identical verified event is safe and should return the
   existing paid order/account without another grant.
4. A reused provider event ID pointing to a different order is a security
   incident and must never be force-accepted.

## Suspected Duplicate User Payment

Do not issue an off-ledger refund or delete one order. Confirm whether the
provider actually captured two distinct orders. Follow the provider and legal
support process. Any later corrective refund/reversal must arrive through the
step-seven compensating-event path so money, payment state and points remain
reconcilable.

## Manual Database Rule

Operators may run read-only queries from the approved dashboard. They may
disable checkout and request official provider event redelivery. They may not:

- update `point_accounts.available_points`;
- insert or delete point lots or transactions;
- mark an order paid based on a browser redirect or screenshot;
- replay a webhook with a bypassed signature;
- expose provider secrets in logs or tickets.

Any exceptional corrective write requires a reviewed migration or admin tool
that creates compensating records; direct SQL balance edits are forbidden.

## Automated Reversal Verification

1. Confirm the reversal event passed the official provider signature check and
   matches provider, merchant, order, amount and currency.
2. Confirm the payment order is `reversed`, with one compensating reversal for
   each purchased/bonus lot that existed.
3. Confirm available balance is not negative. If some granted points were
   already consumed, verify the recovery shortfall and `risk_hold` status.
4. Redelivering the identical provider event must return the existing result
   without another balance change.
5. Never clear `risk_hold` merely because a user contacts support. Resolution
   requires a reviewed recovery/waiver process with compensating audit records.

## Before Live Pilot Checklist

- provider adapter uses the provider's current official signature procedure;
- merchant/account/amount/currency mismatch tests pass;
- duplicate event and concurrent webhook tests pass against PostgreSQL;
- provider settlement bank account is verified;
- webhook URL, certificate/secret rotation and event redelivery are tested;
- named on-call contacts and provider escalation details are filled in;
- legal copy and required refund rights are approved;
- checkout disable switch is tested;
- one minimal real payment is reconciled from provider to order, lots and ledger.
