# Impact Analysis 0009: Alipay Production Adapter

## Decision

Add production Alipay as a second runtime mode of the existing point-payment
port. `PointPaymentService` remains the sole owner of order creation,
verification, idempotent crediting, and reconciliation decisions.

## Affected paths

- Alipay provider configuration and gateway isolation.
- Server composition selected by `ALIPAY_PAYMENT_MODE`.
- Checkout, notification, and return-page composition imports.
- Checkout Content-Security-Policy allow-list.

## Invariants

- `sandbox` accepts only the Alipay sandbox gateway and uses provider ID
  `alipay_sandbox`.
- `production` accepts only `https://openapi.alipay.com/gateway.do` and uses
  provider ID `alipay`.
- Production callback URLs must be explicit public HTTPS URLs. Preview bypass
  credentials are never appended to production callbacks.
- A payment event must match provider, merchant, application, order, currency,
  and amount before the existing repository may credit points.
- No production verification test performs a network request or real charge.

## Migration and rollback

No database migration is required because payment providers are stored as
bounded strings. Switching `ALIPAY_PAYMENT_MODE` back to `sandbox` restores the
previous runtime path without modifying historical production orders.

## Verification

Offline contract tests cover gateway rejection in both directions, redirect
generation, signature verification, query reconciliation, and tamper rejection.
A real production checkout remains a separate, user-authorized verification
after production credentials are configured.
