# ADR-0018: Imported figure assets and model authorization

- Status: accepted; extraction, persistence, owner-scoped display, explicit authorization and provider image admission implemented; real-document rollout verification pending
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
- Step 2 extends the existing import authority to extract supported embedded
  image parts, hash and store them at immutable paths, and bind them to canonical
  `figure` nodes in source order. UI rendering, provider admission and diagnostic
  composition remain deferred.
- Step 3 keeps the canonical figure node as presentation authority. The Figure
  Asset Repository returns owner-scoped immutable metadata and a storage read
  adapter creates a one-hour private URL. The browser receives no durable
  storage path and cannot infer source order or caption metadata.
- Browser-safe raster images render inline. Unsupported or unavailable assets
  remain visible as an in-place fidelity fallback. Workspace display is not
  consent to send an image to a model.
- Step 4 adds one current authorization record per document with optimistic
  authorization revision control. Consent is asset-scoped and bound to the
  current canonical Revision; any Revision change makes prior consent
  ineffective until the user confirms it again. This step does not yet transmit
  image bytes to a provider.
- Step 5 extends the existing hierarchical checker rather than adding a second
  diagnostic route. ArgumentMap remains text-only; root diagnosis receives only
  supported, authorized, integrity-verified images through transient data URLs.
  Every paid root attempt re-reads current authorization. The model receives
  execution-local `I*` references bound to frozen `N*` locations and never sees
  asset IDs, object paths or durable URLs. Missing consent or unusable assets
  produce an explicit text-only coverage projection instead of a false claim
  that figures were inspected.

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

- User-visible behavior: import summaries can report extracted figure counts,
  while unsupported/floating fidelity limits remain explicit warnings.
- Affected modules and consumers: grant DOCX import, private object storage,
  initial revision transaction and canonical figure nodes.
- Data/schema impact: additive immutable figure-asset table and an extension of
  the existing atomic foundation RPC; migration 048 must precede deployment.
- Security/privacy impact: establishes default-deny, per-revision image consent.
- Compatibility and deletion condition: existing snapshots and warnings remain
  unchanged until later capabilities replace `image_not_imported` for supported
  assets.
- Rollback: keep text import active, revert the runtime changes and migration
  before any later authorization/UI capability depends on persisted assets.

## Verification

- Contract tests reject missing program identity, invalid integrity hashes,
  inconsistent caption metadata, duplicate asset scopes and semantic-use
  permission without transmission consent.
- Grant architecture, encoding and TypeScript checks pass.
- A generated DOCX fixture verifies byte extraction, dimensions, caption/source
  anchors, storage hash/path, canonical node order and atomic repository input.
- Migration 048 atomic persistence is verified. Migration 049 additionally
  verifies owner isolation and exact signed-byte integrity for workspace reads.
- Authorization tests verify default deny, asset scope, Revision invalidation,
  renewal, revocation and current-state materialization. Later rollout must
  additionally measure multimodal diagnostic coverage.
- Multimodal contract tests verify that ArgumentMap contains no image payload,
  root diagnosis receives authorized image parts, and every root retry rechecks
  admission through the same Model Data Gateway authority.
