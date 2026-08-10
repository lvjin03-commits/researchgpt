import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantFigureDisplayService } from "../lib/grants/application/figure-display-service.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import type { GrantImportedFigureAsset } from "../lib/grants/domain/figure-assets.ts";

const documentId = "12000000-0000-4000-8000-000000000001";
const revisionId = "12000000-0000-4000-8000-000000000002";
const sectionId = "12000000-0000-4000-8000-000000000003";
const figureNodeId = "12000000-0000-4000-8000-000000000004";
const assetId = "12000000-0000-4000-8000-000000000005";

const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "图片工作区测试",
  sections: [{ sectionId, semanticRole: "research_route", title: "研究路线", order: 0, nodeIds: [figureNodeId] }],
  nodes: [{
    nodeId: figureNodeId,
    sectionId,
    order: 0,
    nodeType: "figure",
    content: { assetId, altText: "技术路线图", caption: "图 1 技术路线图" },
  }],
};

const baseAsset: GrantImportedFigureAsset = {
  assetId,
  documentId,
  sourceRevisionId: revisionId,
  sourceDocumentChecksum: "a".repeat(64),
  contentHash: "b".repeat(64),
  mediaType: "image/png",
  byteSize: 128,
  widthPx: 800,
  heightPx: 600,
  storage: { bucket: "private", path: "owner/private-image.png" },
  anchor: {
    sourceOrdinal: 0,
    relationshipId: "rId1",
    partName: "word/media/image1.png",
    anchorKind: "inline",
    sectionLocalKey: "section-1",
    precedingBlockLocalKey: null,
    followingBlockLocalKey: null,
    caption: { text: "图 1 技术路线图", source: "word_caption" },
  },
  createdAt: "2026-08-10T12:00:00.000Z",
};

let listedAssets: GrantImportedFigureAsset[] = [baseAsset];
const revisions = {
  listImportedFigureAssets: async (requestedDocumentId: string) => {
    assert.equal(requestedDocumentId, documentId);
    return listedAssets;
  },
} as unknown as GrantRevisionService;
let readerCalls = 0;
const service = new GrantFigureDisplayService(revisions, {
  createTemporaryReadUrl: async (asset) => {
    readerCalls += 1;
    assert.equal(asset.storage.path, baseAsset.storage.path);
    return `https://example.test/private/${asset.assetId}?token=temporary`;
  },
});

const ready = await service.listForSnapshot(documentId, snapshot);
assert.deepEqual(ready, [{
  assetId,
  status: "ready",
  mediaType: "image/png",
  widthPx: 800,
  heightPx: 600,
  readUrl: `https://example.test/private/${assetId}?token=temporary`,
}]);
assert.equal(readerCalls, 1);
assert.equal("storage" in ready[0], false, "The browser projection must not expose durable storage metadata.");

listedAssets = [{ ...baseAsset, mediaType: "image/x-emf" }];
const unsupported = await service.listForSnapshot(documentId, snapshot);
assert.equal(unsupported[0]?.status, "unsupported_format");
assert.equal(readerCalls, 1, "Unsupported formats must not receive a signed browser URL.");

listedAssets = [];
const unavailable = await service.listForSnapshot(documentId, snapshot);
assert.deepEqual(unavailable, [{ assetId, status: "unavailable" }]);

const canvasSource = await readFile(new URL("../components/grants/grant-document-canvas.tsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../components/grants/grant-structured-editor.tsx", import.meta.url), "utf8");
assert.match(canvasSource, /<img/);
assert.match(canvasSource, /figureAssetsById\.get\(node\.content\.assetId\)/);
assert.match(canvasSource, /node\.content\.caption/);
assert.match(canvasSource, /unsupported_format/);
assert.doesNotMatch(canvasSource, /storage\.path/);
assert.match(editorSource, /figureAssets=\{payload\.figureAssets\}/);

console.log("Grant imported-figure workspace contracts passed.");
