# Impact analysis: web-grounded GPT-5.5 price policy

## Scope

- Adds four immutable, effective-dated price policies for the existing web-grounded
  child Operations; it adds no Operation, route, provider or wallet.
- Uses the official GPT-5.5 standard rates current on 2026-09-11: USD 5.00 per
  million input tokens, USD 0.50 per million cached input tokens and USD 30.00
  per million output tokens. Hosted web search is USD 10.00 per 1,000 calls.
- Uses the existing point definition (CNY 0.01 per point), a versioned USD/CNY
  rate of 7.20 and zero markup.
- Defines a 50-point maximum user charge across the four bundles. This is a
  product charge ceiling, not a provider-usage ceiling. Observed usage above the
  billable range remains metered and the platform absorbs the overage.
- Does not enable charging. Migration 069 and the charging rollout policy both
  require separate production authorization.

## Ownership and rollback

- The site-wide price catalog remains the sole owner of conversion and rounding.
- Grant code supplies only operation identity, observed usage and the approved
  billable ranges; it cannot calculate or deduct points.
- Before migration 069 is applied, rollback is code rollback. After application,
  immutable historical policies remain for audit; a later effective-dated policy
  supersedes them. Charging can always be stopped through the rollout flag.

## Verification

- Offline tests parse all four policies and verify their official rates, zero
  markup, exchange-rate version and per-bundle maxima of 8, 15, 10 and 17 points.
- PostgreSQL migration application, production lookup and signed-in point-statement
  effects remain unverified until explicitly authorized.
