# Impact Analysis 0002: Structured Editor and Revision Recovery

- Status: accepted for PR2 implementation
- Date: 2026-08-07
- Scope: Grant bounded context only

## Intended Effect

An authenticated user can create a structured grant document, edit canonical
section/node content, see a deterministic length estimate, leave and reload the
page without losing the latest committed revision, and restore an older
revision as a new immutable revision.

## Authority and Data Flow

No authority moves in PR2:

```text
Editor/API
  -> Grant editor application service
  -> Revision Service
  -> GrantRevisionRepository.compareAndSwap
  -> PostgreSQL RPC transaction
```

- The editor never writes grant tables.
- Autosave is a normal Revision Service commit with an expected revision ID.
- A stale autosave returns `revision_conflict`; it never overwrites newer work.
- Restore does not move the current pointer backwards. It copies the selected
  immutable snapshot into a new revision through the same compare-and-swap.
- Length estimates are deterministic projections and are not stored as a
  second source of document truth.

## Modules Changed

- `lib/grants/domain`: revision summary and length-estimate contracts.
- `lib/grants/application`: list/get/restore use cases and length estimator.
- `lib/grants/ports`: revision-history read capabilities.
- `lib/grants/infrastructure/supabase`: RPC adapter and server composition root.
- `app/api/grants`: authenticated HTTP boundary only.
- `app/grants` and `components/grants`: presentation and local edit state only.
- `supabase/migrations`: additive read RPCs; existing write RPCs remain the
  single write authority.

## Existing Product Impact

- Chat, Document V2, literature, STORM, upload, and export routes are unchanged.
- No existing database table or RPC is removed or reinterpreted.
- `GRANT_WORKSPACE_ENABLED` defaults to off; disabling it blocks new Grant UI
  and API traffic without deleting canonical data.
- No AI/model provider is introduced.

## Failure and Recovery

- Network failure: local content remains visible and the editor reports that it
  is not saved; the next edit/retry uses the same current revision.
- Concurrent write: autosave stops, shows a conflict, and requires explicit
  reload of the server revision.
- Browser reload: the current aggregate is fetched from PostgreSQL.
- Historical restore: creates a new revision with audit metadata identifying
  the source revision.

## Verification

1. Contract tests cover deterministic length estimation and restore-as-new.
2. Two saves from one base revision produce one commit and one conflict.
3. Reload returns the committed canonical snapshot.
4. Restore preserves history and advances the revision number.
5. The actual `/grants` -> create -> edit -> autosave -> reload -> restore user
   path is exercised before the capability is called ready.

## Rollback

Turn off `GRANT_WORKSPACE_ENABLED`. Existing canonical revisions remain
readable through the PR1 repository and no other product path is affected.
