# STORM Recovery Baseline

STORM is a removable enhancement. Document V2 must create, resume, render, and
deliver documents when STORM is disabled, unavailable, or deleted.

## Frozen stable baseline

| Field | Value |
| --- | --- |
| Label | `document-v2-pre-storm-runtime` |
| Git commit | `c500b1f` |
| Git tag | `stable-document-v2-pre-storm-runtime-2026-08-02` |
| Stable branch | `stable/document-v2-pre-storm-runtime` |
| Vercel deployment ID | `dpl_2YLwwXoCPY8rfFjaif8KHcCCidxf` |
| Vercel deployment URL | `https://researchgpt-hdshi1mjs-researchgpt1.vercel.app` |
| Database migration baseline | `028_document_v2_reasoning_observability.sql` |
| STORM database migrations | None |
| Verified behavior | Production build, Document V2 orchestration, and real DOCX generation passed |
| Verified date | `2026-08-02` |

The tag is immutable. The stable branch is not a development branch.

## Recovery order

1. Set `STORM_RUNTIME_APPROVED=false`.
2. Confirm a normal Document V2 job can still reach DOCX delivery.
3. If the web deployment is unhealthy, promote the frozen Ready deployment.
4. If code rollback is required, create a recovery branch and revert the bad
   commits. Do not reset or force-push `main`.
5. Restore database state only if an incompatible migration has damaged
   backward compatibility.

## Database rule

Future STORM migrations must be additive: expand, backfill, switch, then
contract in a later release. Existing Document V2 field meanings must not be
changed. Stable code must be able to ignore STORM tables and nullable bindings.

## Mode behavior when globally disabled

- `off`, `shadow`, and `advisory`: run the original Document V2 path.
- `required`: pause with `runtime_disabled`; never silently downgrade a user
  request for deep research.
- No mode may start, inspect, or load a Research Exploration execution.

## Verification commands

```powershell
npm run test:storm-runtime-off
npm run check:research-exploration-boundaries
npm run test:research-exploration-shadow
npm run test:research-exploration-advisory
npm run test:research-exploration-required
npm run test:document-v2-orchestrator
npm run build
```

The runtime-off test includes generation of a real DOCX fixture. A production
rollout must additionally create and download a document through the user UI.
