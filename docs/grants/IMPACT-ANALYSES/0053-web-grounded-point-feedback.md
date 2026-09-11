# Impact analysis: web-grounded point feedback

## Scope

- Extends the existing Grant Assistant GET response with a read-only charging
  preview and a delivered web-answer response with actual charged points.
- Shows the 50-point reservation ceiling and available balance only to an
  eligible Canary account. Non-Canary users retain the existing interface.
- Disables sending before dispatch when the preview reports insufficient
  points, risk hold or the daily ceiling; the server guard remains authoritative.
- Updates the displayed balance after a successful charged answer.

## Ownership and rollback

- The ledger and rollout policy remain authoritative; the browser does not
  calculate charges or grant permission to dispatch.
- Removing the feedback fields is a compatible rollback because they are
  additive. Disabling Canary hides all charging UI and restores meter-only use.
- No migration, deployment, Canary enablement or paid provider call is included.

## Verification

- TypeScript, Grant architecture, encoding, billing guard, Grant Assistant and
  workspace UI contract checks pass offline.
- Production authenticated UI behavior remains unverified until the database
  migration and Canary rollout are separately authorized.
