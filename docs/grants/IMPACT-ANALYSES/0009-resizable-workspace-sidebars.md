# Impact Analysis: Resizable Grant Workspace Sidebars

## Outcome

The grant editor's document-outline and diagnostics sidebars can be resized
independently on desktop. Text in each sidebar scales within a bounded range as
that sidebar changes width.

## Authority and Scope

- `GrantResizableWorkspace` owns presentation-only panel dimensions.
- Grant document structure remains owned by the Grant Document Model.
- Diagnostics, revisions, evidence authorization, patches, saving, and export
  keep their existing authoritative owners.
- No route, data contract, database schema, model call, or canonical-content
  write path changes.

## Safety Boundaries

- Widths and text scale are bounded; the center editor keeps a 560 px minimum.
- Resizing is active only at the existing desktop three-pane breakpoint.
- Pointer and keyboard resizing use the same width owner.
- Smaller viewports keep the existing single-column flow.
- The setting is session-local and does not create a second persisted
  preference model.

## Regression Surface

- Document outline selection and revision restore.
- Canonical content editing and explicit save.
- Diagnostic navigation, feedback, and AI Patch acceptance.
- Evidence display and Word export.

## Rollback

Remove `GrantResizableWorkspace`, restore the prior fixed CSS grid, and remove
the associated presentation styles. No user data or migration rollback is
required.
