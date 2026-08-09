# PR4 Impact Analysis: Three-pane diagnostic workspace

## Problem and Evidence

- Observed behavior: PR2 exposes editing and revision history, while PR3 exposes
  Findings only through an API. Users cannot move directly between a Finding and
  its current source node, and user disposition is not persisted.
- Reproduction or production evidence: the existing editor right rail contains
  length and revision data only; no component consumes the diagnostic endpoint.
- Root cause: the presentation layer and Feedback Service planned for PR4 do not
  exist yet.
- Why this is not only a symptom: adding issue text directly to the editor would
  make the UI reinterpret checker ownership and would leave feedback unaudited.

## Ownership

- Current authoritative owners: Revision Service owns canonical content;
  Diagnostic Service and Assembler own Findings and anchor resolution.
- Owner after the change: those owners remain unchanged; Feedback Service owns
  only the user's disposition toward a Finding.
- Downstream consumers: the existing structured editor and authenticated Grant
  API.
- Decisions downstream modules must not reinterpret: Finding conclusions,
  confidence, source resolution, current revision, and canonical node content.

## Scope

- Files/modules expected to change: grant feedback contracts/application/ports/
  repositories, additive Supabase migration and RPCs, grant API routes, the
  existing structured editor, PR4 contract tests and status documentation.
- User-visible behavior that must change: users see a three-pane workspace, run
  diagnostics, open collapsed issue cards, navigate Finding to source and source
  to Finding, and record a disposition without changing the checker conclusion.
- Existing behavior that must remain unchanged: autosave, optimistic concurrency,
  revision restore, length estimate, chat, Document V2, STORM and export.
- Data/schema impact: one additive owner-scoped feedback table and RPC boundary;
  Findings remain immutable.
- Security/privacy impact: service-role-only storage; all reads/writes verify the
  Finding belongs to a document owned by the authenticated user.

## Options

- Chosen approach: extend the one existing editor and consume the existing
  diagnostic API; persist disposition through a dedicated Feedback Service.
- Rejected alternatives: a second review page, browser-only feedback, deriving
  severity, or letting UI code update Finding rows.
- Why the change does not create parallel authority: the UI only projects data
  returned by the current Revision, Diagnostic and Feedback services.
- Code or path that will be removed: the editor's current static right rail is
  replaced by the diagnostic rail; no compatibility branch remains.

## Migration and Rollback

- Compatibility period: the whole workspace remains behind
  `GRANT_WORKSPACE_ENABLED`.
- Removal condition: none; PR4 replaces the existing grant editor presentation.
- Feature flag: `GRANT_WORKSPACE_ENABLED` remains off in production.
- Rollback behavior: disable the flag or revert the UI/API consumers; canonical
  revisions and immutable Findings remain readable.
- Data readability after rollback: feedback rows are additive and do not affect
  document, revision or diagnostic reads.

## Verification

- Contract test: feedback ownership, immutable Finding conclusions, navigation
  mapping and collapsed-card defaults.
- Architecture check: `npm run check:grant-architecture`.
- Regression scenarios: autosave, stale revision rejection, restore, diagnostic
  persistence and owner isolation.
- Real user-path check: create/open an application, run diagnostics, navigate a
  located Finding to its node and click the node marker to return to its card.
- Real file/output inspection: not applicable to PR4.
- What cannot yet be verified: production exposure remains disabled; real DOCX
  render fidelity remains a PR8 gate.
