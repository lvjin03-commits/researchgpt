# Account Summary and Global Entry Impact Analysis

## Outcome

Expose one reusable signed-in account entry across the main product surfaces.
The entry shows identity from Supabase Auth and a read-only point balance from
Point Billing Service, then links to the account center.

## Authority and data flow

```text
browser account entry
  -> GET /api/account/summary
  -> Supabase Auth getUser()
  -> Account Summary query composition
       -> Supabase Auth identity
       -> PointLedgerRepository.getAccount(authenticated owner ID)
```

The browser never submits an owner ID. A missing point account is displayed as
zero and is not created as a side effect of reading the header.

## Scope

- Add the authenticated account-summary query boundary.
- Add one shared account menu to the research header, chat workspace, Grant
  list/editor and account center.
- Replace the profile placeholder with a read-only identity summary.
- Show available and reserved point balances without enabling checkout.

## Out of scope

- Profile mutation or avatar upload.
- Point grants, purchases, checkout or charging.
- Transactions, orders and session management.

## Failure behavior

- Unauthenticated summary requests return `401`.
- If point storage is temporarily unavailable, identity remains usable and the
  point value is rendered as unavailable rather than guessed.
- No UI component queries point tables or interprets lots directly.
