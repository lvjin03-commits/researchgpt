# Account Center Shell Impact Analysis

## Outcome

Create one authenticated `/account` route family that will host profile,
points, transactions, orders and security capabilities. This phase provides
navigation and ownership boundaries only. It does not add payment, balance or
account-mutation behavior.

## Existing authorities

- Supabase Auth owns identity, credentials and sessions.
- Profile Service will own editable public profile fields.
- Point Billing Service owns balances, lots, reservations and statements.
- Payment Service owns payment orders and provider-confirmed payment state.
- Account Lifecycle Service will orchestrate closure readiness by querying the
  existing domain authorities; it will not reinterpret their states.

The account UI may display authoritative results and initiate commands through
those services. It must never update auth, point, payment or grant persistence
directly.

## Scope

- Add an authenticated account layout and internal navigation.
- Add overview and explicit placeholder routes for future sections.
- Add `/account` to the existing Supabase session middleware matcher.
- Preserve the requested account URL through the existing `/auth?next=...`
  login flow.

## Out of scope

- Global avatar or point-balance entry.
- Profile editing.
- Point balance, transaction or order queries.
- Checkout, payment callbacks or charging activation.
- Session revocation and account closure.

## Security invariants

1. The server derives the account owner only from `auth.getUser()`.
2. No account route accepts an owner ID from the browser.
3. Middleware provides early redirection; the server layout independently
   fails closed when no authenticated user exists.
4. Placeholder sections do not expose nonfunctional mutation controls.

## Verification

- An unauthenticated `/account` request redirects to
  `/auth?next=/account`.
- An authenticated request displays the account shell and signed-in email.
- Every navigation target renders inside the same protected layout.
- Existing architecture, type and production build checks remain green.
