# Impact Analysis 0008: Alipay AI Web Payment Sandbox Adapter

## Scope and authorization

This change connects the existing provider-neutral Payment Service to the
Alipay AI web-payment sandbox. It is authorized for sandbox integration and
offline verification only. It must not configure production credentials,
enable production checkout, deploy payment routes, or move real money.

## Authority and reuse

- `PointPaymentService` remains the only payment workflow owner.
- `SupabasePaymentRepository` and `confirm_point_payment` remain the only path
  that converts a verified paid order into purchased and bonus point lots.
- The Alipay adapter may create a provider checkout and verify an asynchronous
  notification. It may not calculate points, alter balances, reinterpret order
  status, or write payment tables directly.
- Existing `point_payment_orders` and `point_payment_events` are reused. No
  schema migration or second order model is introduced.

## Checkout contract change

Alipay `alipay.trade.page.pay` returns a signed HTML form that is submitted to
the gateway with POST. The provider-neutral `PaymentCheckout` union therefore
adds one authoritative `html_form` variant alongside the existing redirect and
QR variants. The HTML is returned only by an authenticated server route as a
top-level `text/html` response. Application pages must not inject it with
`dangerouslySetInnerHTML`.

The URL-only checkout assumption is replaced by this union immediately; there
is no parallel Alipay-specific checkout model.

## Sandbox-only configuration

The first adapter accepts only an explicit sandbox runtime and a non-production
gateway allowlisted by server configuration. Required configuration is:

- `ALIPAY_PAYMENT_MODE=sandbox`
- `ALIPAY_APP_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_PUBLIC_KEY`
- `ALIPAY_SELLER_ID`
- `ALIPAY_GATEWAY_URL`
- `ALIPAY_NOTIFY_URL`
- `ALIPAY_RETURN_URL`

Secrets are never returned to the browser, written to the repository, copied
from production, or logged. Missing configuration leaves checkout disabled.

## Routes

- Authenticated checkout: `POST /api/account/payments/alipay/checkout`.
  The browser supplies only whole requested points and an optional opaque
  return-context ID. The server calculates and freezes the CNY amount.
- Public notification: `POST /api/payments/alipay/notify`. It reads the raw
  form body, verifies the RSA2 signature, validates application, seller,
  merchant order, amount and paid status, then delegates to
  `PointPaymentService.confirmWebhook`.
- Read-only return page: `/account/points/payment-return`. Browser return is
  UX only and never proves payment.

## Security and failure behavior

- Only `TRADE_SUCCESS` and `TRADE_FINISHED` can become a successful event.
- Notification identity is the provider `notify_id`; the provider trade number
  is retained only in the sanitized audit projection.
- Signature, application, seller, amount, currency and order identity must all
  match before the database transaction runs.
- The notification route returns plain-text `success` only after idempotent
  business processing succeeds; all other outcomes return `fail`.
- Raw notification bodies, private keys, public keys and unrelated provider
  fields are never persisted or logged.
- `return_url` and browser state cannot grant points.

## Verification and promotion gate

Offline tests use generated test RSA keys and an injected/fake SDK transport;
they do not call a paid model or real payment API. A real Alipay sandbox
end-to-end run additionally requires user-provided sandbox credentials and a
public HTTPS callback. Production promotion requires a separate authorization,
production credentials configured outside the workspace, provider review,
small-value acceptance, reconciliation and rollback verification.

## Rollback

Disable the sandbox configuration or remove the routes and adapter. Existing
orders, ledger entries and account behavior remain unchanged. No payment audit
records are deleted as rollback.
