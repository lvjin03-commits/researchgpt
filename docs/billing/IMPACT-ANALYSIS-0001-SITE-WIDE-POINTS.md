# Impact Analysis 0001: Site-wide Point Billing Authority

## Problem and Evidence

- `ai_usage_events` records general AI usage and estimated provider cost.
- `grant_model_calls` records Grant operation attempts and token usage.
- Neither record is an atomic balance, reservation, settlement, payment or
  reversal authority.
- Adding charging independently to chat, literature and Grant would create
  conflicting wallets, operation names, price rules and failure behavior.
- Real payment must not begin before the internal ledger, pricing and
  deliverability contracts can be verified without money.

## Ownership

- Current authoritative owner: none for customer point balances and charges.
- Owner after the change: one site-wide Point Billing Service and Point Ledger.
- Existing model executors remain owners of raw provider usage facts.
- Existing domain state machines remain owners of technical/business terminal
  states; the registered billing contract maps those states to billability.
- Payment Service owns verified payment status only; it never calculates AI
  consumption or edits a wallet directly.

## Scope

Expected later implementation scope:

- shared AI Operation Registry integration;
- standardized token/tool/media usage;
- versioned Price Catalog;
- atomic point accounts, lots, reservations and append-only transactions;
- payment order/event adapters;
- user estimates, balance and statement projections;
- administrator reconciliation and risk handling;
- adapters from `ai_usage_events` and `grant_model_calls`.

This governance step changes documentation only. It changes no runtime, data,
payment, user balance, AI call or Grant behavior.

## Security, Privacy and Financial Risk

- Browser amounts, point grants, payment success and billability are untrusted.
- Payment events require provider signature verification and idempotency.
- Balance operations require database atomicity and owner isolation.
- Device/network risk collection must be minimized and retained only under an
  approved privacy policy.
- Provider cost and customer charge must remain distinguishable.
- Sensitive prompt/document content must not enter financial telemetry.
- Final public refund and expiry language requires legal review.

## Options

### Chosen

One site-wide point authority. Features report factual standardized usage; one
versioned catalog prices it; one ledger reserves and settles it. Payment is a
later adapter that grants purchased and bonus lots after verified settlement.

### Rejected

- Grant-only points: cannot govern the rest of ResearchGPT.
- One wallet per feature: creates parallel balance and refund authorities.
- A fixed point-to-token ratio: incorrect across models, token classes and
  non-token tools.
- Charging every provider attempt: charges users for unusable platform output.
- Browser-owned estimates or payment success: not authoritative or safe.
- Free AI fail-open during billing outage: creates unaudited cost and abuse.
- Implementing payment before ledger verification: exposes real funds to
  unverified consumption logic.

## Migration and Rollback

- Existing telemetry stays readable and keeps its current owner.
- No existing user is charged by this decision.
- Later charging requires a default-off server capability gate and separately
  authorized production rollout.
- Rollback disables new paid dispatch while preserving point and payment audit
  records; it never deletes balances or rewrites canonical user content.
- No compatibility wallet or duplicate price path is permitted.

## Verification Plan

Before real payment:

- ledger concurrency, idempotency and rollback tests run in CI;
- every billable Operation has a complete terminal-state matrix;
- unknown states are non-billable and observable;
- platform retry cannot raise a confirmed charge ceiling;
- Grant multi-stage and Edit Session Bundle contracts pass;
- payment callbacks pass signature, duplicate and transactional-grant tests;
- user-path verification covers exact top-up, pending confirmation, point grant,
  reservation, successful settlement and failed-result release;
- legal review status is visible and blocks final external refund wording.

## Open Decisions Blocking Later Steps

- professional legal approval of public refund and expiry language;
- exact consumption order among expiring promotional and purchased lots;
- payment-provider/account choice and merchant settlement account;
- server-owned minimum, maximum and risk limits for custom point purchase;
- initial operation-specific price and deliverability policies.
