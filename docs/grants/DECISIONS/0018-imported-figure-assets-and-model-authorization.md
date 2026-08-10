# ADR-0018: Imported figure assets and model authorization

- Status: accepted for contract-only implementation
- Date: 2026-08-10
- Owners: Grant DOCX Import Adapter, Grant Figure Asset Repository, Grant Figure Model Authorization Service, Grant Model Data Gateway
- Supersedes: none
- Superseded by: none

## Context

The active DOCX importer intentionally replaces embedded image payloads with an
empty source and emits `image_not_imported`/`floating_object_not_imported`
warnings. The original DOCX is preserved, but the canonical editor and semantic
diagnostic input therefore cannot inspect those figures. The existing canonical
`figure` node already refers to an `assetId`; expanding the active node into a
second image/document model would duplicate authority.

## Decision

- Keep the canonical `figure` node and existing import route.
- The DOCX Import Adapter will eventually extract OOXML image parts and their
  deterministic source anchors; it does not interpret scientific meaning.
- Grant Figure Asset Repository will own asset ID, integrity hash, immutable
  object location and source-anchor metadata.
- Caption source is recorded separately from caption text so absence is not
  confused with failed extraction.
- Imported images are not Evidence Cards. Their transmission has a dedicated,
  revision-bound, asset-scoped authorization that is denied by default.
- Grant Model Data Gateway remains the only provider admission point and must
  re-read current figure authorization before dispatch.
- Models receive only authorized image payloads and execution-local atomic
  location references. Models never own asset IDs, object paths or canonical
  locations.
- This step adds target contracts and governance only. It does not change import,
  storage, UI, provider or diagnostic composition.

## Alternatives Considered

- Store base64 images inside canonical snapshots: rejected because it duplicates
  assets across revisions and expands every document read/write.
- Treat imported figures as Evidence Sources: rejected because application-body
  images and optional external evidence have different provenance and consent.
- Let the model infer captions/order from rendered pages: rejected because IDs,
  ordering and binding are deterministic program responsibilities.
- Enable model image access whenever text diagnosis is authorized: rejected
  because image transmission is a separate sensitive-data action.

## Impact Analysis

- User-visible behavior: none in this step.
- Affected modules and consumers: target grant domain contracts and governance;
  future import/storage/workspace/gateway/diagnostic adapters.
- Data/schema impact: none; persistence requires a later additive migration.
- Security/privacy impact: establishes default-deny, per-revision image consent.
- Compatibility and deletion condition: existing snapshots and warnings remain
  unchanged until later capabilities replace `image_not_imported` for supported
  assets.
- Rollback: remove unused contracts and governance additions.

## Verification

- Contract tests reject missing program identity, invalid integrity hashes,
  inconsistent caption metadata, duplicate asset scopes and semantic-use
  permission without transmission consent.
- Grant architecture, encoding and TypeScript checks pass.
- Real user-path verification is intentionally deferred because this step has no
  runtime effect.
- Later rollout must measure image extraction success, unsupported media,
  authorization denials and multimodal diagnostic coverage.
