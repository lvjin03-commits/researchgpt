import assert from "node:assert/strict";
import {
  DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS,
  GrantFigureModelAuthorizationSchema,
  GrantImportedFigureAssetSchema,
} from "../lib/grants/domain/figure-assets.ts";

const assetId = "10000000-0000-4000-8000-000000000001";
const documentId = "10000000-0000-4000-8000-000000000002";
const revisionId = "10000000-0000-4000-8000-000000000003";
const actorId = "10000000-0000-4000-8000-000000000004";

const asset = GrantImportedFigureAssetSchema.parse({
  assetId,
  documentId,
  sourceRevisionId: revisionId,
  sourceDocumentChecksum: "a".repeat(64),
  contentHash: "b".repeat(64),
  mediaType: "image/png",
  byteSize: 4096,
  widthPx: 1200,
  heightPx: 800,
  storage: { bucket: "grant-assets", path: `${documentId}/figures/${assetId}/original.png` },
  anchor: {
    sourceOrdinal: 2,
    relationshipId: "rId12",
    partName: "word/media/image2.png",
    anchorKind: "inline",
    sectionLocalKey: "section-1",
    precedingBlockLocalKey: "block-8",
    followingBlockLocalKey: "block-9",
    caption: { text: "图 1 技术路线", source: "word_caption" },
  },
  createdAt: "2026-08-10T12:00:00.000Z",
});
assert.equal(asset.anchor.relationshipId, "rId12");
assert.deepEqual(DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS, {
  sendImageToModel: false,
  useForSemanticDiagnosis: false,
  useForAiEditing: false,
});

assert.throws(() => GrantImportedFigureAssetSchema.parse({
  ...asset,
  assetId: undefined,
}), "asset identity is program-required");
assert.throws(() => GrantImportedFigureAssetSchema.parse({
  ...asset,
  contentHash: "not-a-checksum",
}), "asset integrity must be verifiable");
assert.throws(() => GrantImportedFigureAssetSchema.parse({
  ...asset,
  anchor: { ...asset.anchor, caption: { text: null, source: "word_caption" } },
}), "caption source and text must agree");

const authorization = {
  authorizationId: "10000000-0000-4000-8000-000000000005",
  documentId,
  sourceRevisionId: revisionId,
  authorizationRevision: 1,
  allowedAssetIds: [assetId],
  permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
  expiresAt: null,
  revokedAt: null,
  updatedBy: actorId,
  updatedAt: "2026-08-10T12:00:00.000Z",
};
GrantFigureModelAuthorizationSchema.parse(authorization);
assert.throws(() => GrantFigureModelAuthorizationSchema.parse({
  ...authorization,
  permissions: { sendImageToModel: false, useForSemanticDiagnosis: true },
}), "diagnostic use cannot bypass image transmission consent");
assert.throws(() => GrantFigureModelAuthorizationSchema.parse({
  ...authorization,
  allowedAssetIds: [assetId, assetId],
}), "authorization cannot contain duplicate assets");

console.log("Grant imported-figure asset contracts passed.");
