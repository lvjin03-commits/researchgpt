# Impact Analysis 0005: Payment Ingress and Transactional Point Grant

## Decision

Introduce one provider-neutral Payment Service. It owns pending payment orders
and verified provider events, but it does not own point balances or AI prices.
The database transaction that accepts a verified successful event also grants
the purchased and bonus point lots through the existing Point Ledger authority.

No production payment provider is selected by this change. The included signed
provider is test-only and rejects production use. A real provider adapter,
merchant account, settlement bank account, webhook secret/certificate and
provider-specific user-path verification remain deployment gates.

## Server-Owned Commercial Inputs

- 100 points correspond to CNY 1.00 of usage credit, so one whole point maps to
  one CNY fen at checkout.
- The launch bonus is `floor(purchasedPoints * 13%)` under campaign version
  `launch-bonus-v1`.
- The browser submits only the requested whole-point quantity and an opaque
  return-context ID. Amount, currency, bonus, merchant and policy versions are
  calculated and frozen by the server.
- Minimum and maximum custom-purchase limits are server configuration.

## Security and Failure Boundary

- Browser redirects and QR scan completion never prove payment.
- Webhook verification uses the raw request body and provider headers before
  parsing a business event.
- Merchant, provider order, amount and currency must exactly match the frozen
  pending order.
- Provider event identity and order payment transition are idempotent.
- A duplicate webhook cannot grant either purchased or bonus points twice.
- Provider payload storage is a sanitized audit projection; secrets, card data
  and full untrusted payloads are forbidden.
- A provider checkout failure leaves a traceable pending order and grants no
  points.

## Transaction Boundary

`confirm_point_payment` is the only paid-grant write path. In one PostgreSQL
transaction it locks the order, verifies the frozen payment facts, inserts the
provider event, marks the order paid and grants separate purchased and bonus
lots. Any failure rolls the whole transaction back.

## Rollback

No production route or provider is enabled in this step. The payment capability
remains unavailable until a real adapter is configured. Existing AI, metering
and point-ledger behavior is unchanged. Payment history, once created, is never
deleted as rollback.
