# Point Account and Statement Views Impact Analysis

## Outcome

Replace the point and transaction placeholders with real, owner-scoped views.
The point page and the full transaction page use the same Point Statement
Service, response contract and presentation component.

## Authority

- Point Ledger remains the balance and transaction authority.
- Point Statement Service remains the only user-facing projection owner.
- Account pages render the projection and never query or total ledger rows.
- Supabase Auth supplies the owner ID; the browser cannot select another owner.

## Query contract

The statement query supports cursor pagination, a server-enforced page limit
and an optional transaction-kind filter. Filtering occurs before pagination in
PostgreSQL so the UI never presents a current-page-only filter as complete.

`/account/points` requests the first eight entries. `/account/transactions`
uses the same endpoint and component with pagination and filters.

## Compatibility

Migration 065 adds `point_statement_for_owner_v2`. The original three-argument
RPC is retained only so an older web deployment can survive migration-first
rollout. After the deployment using v2 is verified in production, the original
RPC must be removed in a follow-up migration.

## Out of scope

- Checkout or point purchase.
- Payment-order detail.
- Business-object title snapshots and links; these require a separate ledger
  metadata migration before they can be rendered honestly.
