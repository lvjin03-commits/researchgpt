# Candidate Intelligence Rollout

## Scope

This runbook exposes only deterministic Candidate Diff and the no-write
Candidate explanation operation. It does not authorize Suggested Actions,
free-text operation routing, image generation, Patch acceptance or Revision
writes.

## Preconditions

1. Main CI, Grant architecture checks, Candidate Diff, explanation, cache and UI
   contract tests pass.
2. Apply migrations 057 and 058 in order. Do not set the readiness marker when
   either migration is absent.
3. Confirm `grant_model_calls` admits exactly
   `grant.edit_candidate.explain` with `grant-edit-candidate-explain-v1`.
4. Confirm `grant_candidate_explanations` has RLS enabled and only service-role
   RPC access.
5. Deploy with `GRANT_CANDIDATE_EXPLANATION_ENABLED=false` and
   `GRANT_CANDIDATE_EXPLANATION_DATABASE_SCHEMA=058` first.

## Canary verification

Enable the feature in a non-production or explicitly isolated deployment, then
use a signed-in owner account and a real Chinese Candidate:

1. Click `查看差异`. Verify the UI shows replacement/insertion/deletion/move
   counts and creates no `grant_model_calls` row.
2. Click `解释修改`. Verify one trace uses only
   `grant.edit_candidate.explain`, blocking issues appear first, and no Revision
   or Patch record is created.
3. Click `解释修改` again without changing the Candidate. Verify the stored
   explanation is identical and no new model-call row or provider charge exists.
4. Send two identical explanation requests concurrently. Verify one cache row,
   one execution owner and one caller receiving in-progress or the completed
   projection.
5. Revoke or expire a used Evidence source and retry. Verify the cache key
   changes and the source is visibly non-current.
6. Change the source Revision or Candidate. Verify the old cache is not reused.
7. Submit ordinary assistant prose such as `解释一下刚才改了什么` without
   clicking the Candidate action. Verify it remains `grant.assistant.chat` and
   does not create an explanation call.

## Production enablement

Only after the canary evidence is recorded, set
`GRANT_CANDIDATE_EXPLANATION_ENABLED=true` while retaining exact schema marker
`058`. Monitor provider failures, cache-hit ratio, in-progress conflicts,
`context_budget_exceeded`, token usage and unexpected Patch/Revision activity.

## Rollback

Set `GRANT_CANDIDATE_EXPLANATION_ENABLED=false` and redeploy. This hides the
buttons and makes the API fail closed without deleting model-call audit or
cached explanations. Do not roll back by dropping migrations 057 or 058 during
an incident. Existing Edit Sessions, Candidates, Patches and Revisions remain
unchanged.
