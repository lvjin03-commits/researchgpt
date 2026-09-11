# ADR 0051: Initial web-grounded GPT-5.5 cost policy

## Status

Accepted for implementation and offline verification. Production migration and
charging rollout are not authorized by this ADR.

## Decision

The initial web-grounded Grant Assistant price catalog uses the official GPT-5.5
standard token rates and OpenAI hosted web-search unit rate current on 2026-09-11.
Currency conversion is frozen at USD/CNY 7.20, markup is zero, one point remains
CNY 0.01, and every stage rounds through the existing site-wide price engine.

The initial user charge is capped at 50 points per delivered web-grounded answer,
allocated as follows:

1. query rewrite: 8 points;
2. hosted search response: 15 points;
3. source assessment: 10 points;
4. grounded answer synthesis: 17 points.

These allocations are maximum billable usage ranges. They do not suppress or
falsify observed provider usage. If delivered usage prices above a reserved stage
maximum, the existing settlement engine records the overage as platform-absorbed.
Failed or non-delivered turns release all four reservations under ADR 0043.

## Consequences

The 50-point ceiling favors a predictable trial experience and may subsidize long
answers. Cost recovery must be reviewed from measured canary data before changing
markup, model or cap. A replacement must use a new policy version and effective
date; historical price rows are never rewritten.
