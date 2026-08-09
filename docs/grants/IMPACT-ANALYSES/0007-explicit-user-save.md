# Impact Analysis 0007: Explicit User Save

- Status: accepted for implementation
- Date: 2026-08-09
- Scope: Grant bounded context only

## Intended Effect

Editing a grant application changes only the page-local draft. The canonical
document advances only after the user clicks Save. The header exposes saved,
unsaved, saving, failure and conflict states, and warns before leaving with
uncommitted changes.

## Authority and Data Flow

No authority moves and no parallel save path is added:

```text
Editor local draft
  -> explicit Save button
  -> existing authenticated PATCH route
  -> Grant Editor Service
  -> Revision Service compare-and-swap
  -> PostgreSQL transaction
```

Revision Service remains the only write authority. Diagnostics, AI Patch and
DOCX export remain restricted to the latest committed revision.

## Existing Product Impact

- Automatic delayed PATCH requests are removed from the editor.
- Unsaved edits are not recoverable after a confirmed page departure or reload.
- A browser departure warning reduces accidental loss but is not a hidden draft
  persistence mechanism.
- Chat, Document V2, literature, STORM, evidence authorization, import and
  export implementations are unchanged.
- No database migration or feature flag is required.

## Failure and Concurrency

- A failed save leaves the draft visible and offers an explicit retry.
- A stale base revision remains a conflict and never overwrites newer content.
- Loading the latest revision after a conflict intentionally replaces the
  unsaved page draft only after the user chooses that action.
- Editing while a save is in flight leaves the newer page state marked unsaved
  after the submitted snapshot commits.

## Verification

1. Editing does not send a delayed PATCH request.
2. Save sends exactly one PATCH for the current snapshot.
3. Reload after an unsaved edit returns the previously committed revision.
4. Reload after Save returns the new revision.
5. Stale Save returns a conflict without overwriting either version.
6. Diagnostics, AI Patch and export remain disabled until the draft is saved.

## Rollback

Reverting the presentation change restores automatic triggering while using the
same Revision Service and database contract. No canonical data migration is
needed.
