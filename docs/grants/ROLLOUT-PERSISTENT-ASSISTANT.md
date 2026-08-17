# Persistent Grant Assistant rollout

## Preconditions

1. Apply migrations 055 and 056 in order.
2. Confirm the existing Edit Session, Evidence and OpenAlex snapshot flags for
   the intended canary accounts.
3. Set `GRANT_ASSISTANT_CHAT_DATABASE_SCHEMA=056` before enabling traffic.
4. Set `GRANT_ASSISTANT_CHAT_ENABLED=true` only for the intended deployment.

The API fails closed if either assistant variable is absent. Do not enable the
UI flag before migration 056 is visible to the application service role.

## Canary path

For one test application, verify all of the following in the rendered product:

1. Ask an ordinary question, refresh, and confirm both messages restore.
2. Reference a saved text selection and confirm the answer shows its source.
3. Change the underlying paragraph before sending and confirm stale context is
   rejected without a provider call.
4. Upload and authorize a local file, select it, and confirm the answer is
   grounded only in admitted excerpts.
5. Run academic search, confirm one result, and confirm only its fixed snapshot
   is admitted.
6. Open two different Edit Sessions, continue each independently, and confirm
   candidate application still advances the canonical Revision through CAS.
7. Inspect `grant_model_calls` by trace ID and confirm one initial attempt plus
   at most one controlled repair.

## Rollback

Set `GRANT_ASSISTANT_CHAT_ENABLED=false`. This hides the assistant chat and
rejects its API without deleting assistant sessions, messages, Edit Session
links, model telemetry, candidates, Patches or Revisions. Do not roll back by
dropping migrations 055 or 056.

## Maintenance

Invoke `maintain_grant_assistant_sessions(now())` from the approved scheduled
maintenance runner. It marks seven-day inactive sessions stale, expires
90-day inactive sessions and deletes only eligible unlinked general-reasoning
turns. Grounded or Edit Session-linked history is not removed by this cleanup.
