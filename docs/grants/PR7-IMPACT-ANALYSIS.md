# PR7 Evidence-backed AI Patch Impact Analysis

## Problem and Evidence

- Observed behavior: uploaded project evidence can be parsed and authorized, but
  the existing AI Patch request always sends an empty evidence array.
- Root cause: PR5 Patch and PR6 Evidence were deliberately delivered as isolated
  capabilities; no application contract currently joins them.
- Why this is not only a symptom: adding evidence directly in the UI or provider
  adapter would bypass the current-authorization owner and create a second model
  context path.

## Ownership

- Evidence permission remains owned by `GrantEvidenceAuthorizationService`.
- Model context construction remains owned by `GrantModelDataGateway`.
- Patch scope and canonical writes remain owned by Patch Policy and Revision
  Service respectively.
- The model may select only program-issued Evidence Card IDs. It cannot create
  source IDs, citation numbers, or write canonical content.

## Scope

- Extend the existing Patch request with optional evidence source IDs.
- Materialize currently authorized evidence at model-dispatch time, select a
  bounded set of cards, and persist only evidence provenance in the proposal.
- Revalidate evidence before accepting an evidence-backed proposal. The final
  authorization guard, Revision compare-and-swap, and proposal acceptance share
  one database transaction so revocation cannot race a canonical write.
- Register proposal-to-source dependencies transactionally with proposal
  creation so revocation invalidates pending proposals.
- Preserve the evidence-free PR5 behavior when no source is selected or the PR7
  feature flag is off.
- Do not add a new route, Patch service, model gateway, canonical content model,
  or citation-numbering implementation.

## Security and Privacy

- Evidence is untrusted data and is delimited as data in the provider request.
- Every selected source must currently allow model excerpts and reasoning.
- `highly_sensitive` sources are rejected by the model-data gateway.
- Raw evidence excerpts are not copied into Patch proposals or audit metadata.
- Proposal provenance stores program-issued IDs, content hashes, authorization
  revisions, and display titles only.

## Migration and Rollback

- Migration `041_grant_evidence_backed_patches.sql` adds transactional proposal
  creation and guarded acceptance RPCs;
  existing tables and JSON proposals remain readable.
- Feature flag: `GRANT_EVIDENCE_PATCH_ENABLED` (default off).
- Rollback: disable the flag. Evidence-free AI Patch and local evidence upload
  continue unchanged. Existing evidence-backed proposals remain readable and
  can be rejected or invalidated.

## Verification

- Contract tests cover current authorization, model-ID allowlists, proposal
  provenance, revocation before acceptance, and evidence-free regression.
- `npm run check:grant-architecture` must pass.
- The real UI path must be verified after migration and feature-flag deployment;
  local code checks alone do not prove production readiness.
