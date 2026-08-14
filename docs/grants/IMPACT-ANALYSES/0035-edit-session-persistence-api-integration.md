# Impact Analysis 0035: Edit Session persistence and authenticated API

## Outcome

Replace the development-only in-memory boundary in production composition with owner-scoped Supabase repositories for Edit Sessions, Turns, Candidates, model-call telemetry and confirmed web-source provenance. Expose authenticated no-store APIs for create, restore, continue and apply.

## Rollout

The API fails closed unless both `GRANT_AI_EDIT_SESSION_ENABLED=true` and `GRANT_AI_EDIT_SESSION_DATABASE_SCHEMA=053` are present. Migrations 053 and 054 are forward-only additions; neither changes canonical grant content. The web provider/fetcher and UI remain uncomposed, so web routes are not exposed in this step.

## Ownership

Route handlers validate transport data and document/session ownership only. They delegate lifecycle decisions to Edit Session Service and canonical writes to Patch/Revision Service. Tables are inaccessible to `anon` and `authenticated`; service-role RPCs recheck document ownership.

## Verification boundary

Static migration/security checks, route contract checks, typecheck and architecture checks are included. Real PostgreSQL migration probes and signed-in browser verification remain required before enabling the flag.

