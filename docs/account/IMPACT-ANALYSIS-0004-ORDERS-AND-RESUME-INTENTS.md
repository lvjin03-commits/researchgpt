# Orders and Recharge Resume Intents Impact Analysis

## Outcome

Expose owner-scoped payment-order history and introduce a server-owned resume
intent for operations interrupted by insufficient points. No checkout provider
or charging path is enabled in this phase.

## Authorities

- Payment Query Service owns the user-facing order projection.
- Payment Service and verified provider events remain the only payment-state
  mutation authority.
- Resume Intent Service owns recharge-wait context and lifecycle.
- The original Grant, Document or Chat service remains responsible for target
  authorization and baseline validation before an intent can become ready.

## Resume lifecycle

```text
awaiting_payment
  -> needs_revalidation  (verified payment transaction only)
  -> ready               (owning operation validates permission and baseline)
  -> consumed            (user explicitly confirms continuation)

needs_revalidation -> stale
any active state -> cancelled / expired
```

Payment success never executes an AI call or content write. It only makes the
intent eligible for revalidation. Draft instructions may be restored to the UI
after a stale result, but cannot be submitted automatically.

## Security

- Owner identity comes from Supabase Auth. Resume-intent RPCs are service-role
  only, and the server passes that authenticated owner; browsers cannot invoke
  lifecycle transitions directly.
- Operation IDs must come from the shared AI Operation Registry.
- Intent context uses a strict schema; arbitrary nested metadata is rejected.
- Orders expose ResearchGPT order IDs, never card or bank credentials.

## Compatibility and rollout

Migration 066 adds read-only order pagination, resume-intent storage and a
database trigger that moves an intent to `needs_revalidation` in the same
transaction that marks its linked order paid. It does not create a checkout
route and does not activate production payments.
