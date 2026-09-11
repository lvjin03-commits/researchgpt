# ADR 0052: Guarded Canary charging for web-grounded Grant answers

## Status

Accepted for implementation and offline verification. Production migration,
Canary enablement and deployment remain separately authorized actions.

## Decision

The existing Grant Assistant web-grounding route is wrapped at composition time
by the site-wide atomic delivery charging service. A single 50-point reservation
budget covers query rewrite, hosted search, source assessment and answer
synthesis. The four child operations retain separate immutable prices and usage
records, while delivery remains atomic from the user's perspective.

Only an owner and operation explicitly named by an unexpired Canary policy may
be charged. Before any paid provider call, the adapter verifies an active point
account, at least 50 available points, the per-answer cap, the Canary daily cap
and all four active price policies. Failure of any check prevents dispatch.

Accounts outside the Canary continue through the existing metered zero-point
path. A fallback that produces no web-grounded answer is internal-only and
releases all reservations; only a delivered answer may settle points.

## Consequences

The user charge is predictable and no partial failed workflow can consume
points. Reserving the full cap may temporarily deny a request whose eventual
cost would have been lower, which is preferable to dispatching paid work without
funds. The rollout flag is the immediate rollback control.
