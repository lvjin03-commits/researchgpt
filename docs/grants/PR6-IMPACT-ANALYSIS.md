# PR6 Impact Analysis: Project evidence and authorization

## Problem and Evidence

- Observed behavior: the grant workspace can edit, diagnose and propose an
  evidence-free patch, but it cannot persist project literature or authorize
  evidence use.
- Reproduction: PR5 deliberately sends an empty evidence set; ADR-0008 records
  that evidence use is deferred to PR6.
- Root cause: Evidence Authorization Service, Evidence Cards and revocation
  propagation exist only as accepted contracts and spike results, not product
  code.
- Why this is not only a symptom: adding evidence directly to the patch prompt
  would bypass the single authorization owner and make revocation unreliable.

## Ownership

- Current authoritative owner: none in production; ADR-0007 defines the future
  Evidence Authorization Service.
- Owner after the change: `GrantEvidenceService` for source lifecycle and
  current authorization; repositories only persist its decisions.
- Downstream consumers: project-resource UI and, in PR7, Grant Model Data
  Gateway.
- Decisions downstream modules must not reinterpret: current permissions,
  authorization revision, source sensitivity, revocation and deletion state.

## Scope

- Modules: evidence contracts/application service/ports/adapters, owner-scoped
  API routes, project-resource UI, migration 040, contract tests and status
  documentation.
- User-visible change: upload PDF/DOCX/TXT/Markdown resources, inspect
  deterministic Evidence Cards, separately authorize read/index/model/reasoning
  and citation permissions, revoke or delete a source.
- Unchanged behavior: editing, diagnostics, PR5 evidence-free patches, imports,
  chat and Document V2.
- Data impact: additive owner-scoped evidence, authorization, card, dependency
  and audit records. No existing table is repurposed.
- Security/privacy: uploaded content is untrusted; model permissions default
  off; original objects use program-owned paths; deletion wipes excerpts before
  external object cleanup completes.

## Options

- Chosen: one Evidence Authorization Service, current authorization queried
  from durable storage, transactional dependency invalidation, recoverable
  object deletion.
- Rejected: putting evidence flags in UI state, caching send-ready excerpts,
  adding evidence fields directly to PR5 prompts, or reusing the literature
  workspace as a second authorization authority.
- Parallel authority: none. Shared parsing and object storage are used behind
  grant-specific ports only.
- Removed path: none; this is the first implementation of the accepted owner.

## Migration and Rollback

- Compatibility: additive migration; old readers remain valid.
- Removal condition: no compatibility branch is introduced.
- Flag: `GRANT_LOCAL_EVIDENCE_ENABLED`, disabled by default.
- Rollback: turn off the flag. Canonical grant content and PR5 patches remain
  readable and writable.
- Data readability: evidence data remains owner-scoped and can be re-enabled;
  rollback does not delete it.

## Verification

- Contract: defaults deny model use; authorization CAS; expired/limited grants;
  revocation invalidates queue/cache/draft dependencies; deletion wipes cards.
- Architecture: `npm run check:grant-architecture`.
- Regression: existing grant foundation/editor/diagnostic/import/patch suites.
- User path: upload, view cards, authorize, revoke and delete through `/grants`.
- File inspection: confirm a real PDF or DOCX produces readable Evidence Cards.
- Not yet verified: production PostgreSQL/storage and browser path until the
  migration, flag and deployment are separately authorized.
