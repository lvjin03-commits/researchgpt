import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GrantFigureAuthorizationDeniedError,
  GrantFigureModelAuthorizationService,
} from "../lib/grants/application/figure-model-authorization-service.ts";
import type { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import type { GrantFigureModelAuthorization, GrantImportedFigureAsset } from "../lib/grants/domain/figure-assets.ts";
import type { GrantFigureAuthorizationRepository } from "../lib/grants/ports/grant-figure-authorization-repository.ts";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";

const documentId = "13000000-0000-4000-8000-000000000001";
const revision1 = "13000000-0000-4000-8000-000000000002";
const revision2 = "13000000-0000-4000-8000-000000000003";
const sectionId = "13000000-0000-4000-8000-000000000004";
const nodeId = "13000000-0000-4000-8000-000000000005";
const assetId = "13000000-0000-4000-8000-000000000006";
const actorId = "13000000-0000-4000-8000-000000000007";
const authorizationId = "13000000-0000-4000-8000-000000000008";
const assetBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const snapshot = {
  schemaVersion: "grant-canonical-v1" as const,
  title: "Figure authorization",
  sections: [{ sectionId, semanticRole: "route", title: "Route", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "figure" as const, content: { assetId, altText: "route", caption: "Figure 1" } }],
};
const asset: GrantImportedFigureAsset = {
  assetId,
  documentId,
  sourceRevisionId: revision1,
  sourceDocumentChecksum: "a".repeat(64),
  contentHash: createHash("sha256").update(assetBytes).digest("hex"),
  mediaType: "image/png",
  byteSize: assetBytes.byteLength,
  widthPx: 100,
  heightPx: 50,
  storage: { bucket: "private", path: "owner/image.png" },
  anchor: {
    sourceOrdinal: 0,
    relationshipId: "rId1",
    partName: "word/media/image1.png",
    anchorKind: "inline",
    sectionLocalKey: "section",
    precedingBlockLocalKey: null,
    followingBlockLocalKey: null,
    caption: { text: "Figure 1", source: "word_caption" },
  },
  createdAt: "2026-08-10T12:00:00.000Z",
};

let currentRevisionId = revision1;
const revisions = {
  getDocument: async () => ({ currentRevision: { revisionId: currentRevisionId, snapshot } }),
  listImportedFigureAssets: async () => [asset],
} as unknown as GrantRevisionService;

class MemoryAuthorizationRepository implements GrantFigureAuthorizationRepository {
  current: GrantFigureModelAuthorization | null = null;
  async getCurrent() { return this.current; }
  async save(input: Parameters<GrantFigureAuthorizationRepository["save"]>[0]) {
    assert.equal(input.expectedAuthorizationRevision, this.current?.authorizationRevision ?? 0);
    this.current = input.authorization;
    return input.authorization;
  }
}

const repository = new MemoryAuthorizationRepository();
let now = "2026-08-10T12:00:00.000Z";
const service = new GrantFigureModelAuthorizationService(revisions, repository, () => authorizationId, () => now);

const initial = await service.getCurrent(documentId);
assert.deepEqual(initial.effectivePermissions, { sendImageToModel: false, useForSemanticDiagnosis: false });
assert.deepEqual(initial.eligibleAssetIds, [assetId]);

const authorized = await service.authorize({
  documentId,
  expectedAuthorizationRevision: 0,
  allowedAssetIds: [assetId],
  permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
  actorId,
});
assert.equal(authorized.authorization?.authorizationRevision, 1);
assert.equal(authorized.effectivePermissions.useForSemanticDiagnosis, true);
assert.deepEqual((await service.materializeCurrentForSemanticDiagnosis(documentId)).assets.map((item) => item.assetId), [assetId]);

let admitted: Awaited<ReturnType<NonNullable<Parameters<NonNullable<ConstructorParameters<typeof GrantModelDataGateway>[0]["diagnoseHierarchical"]>>[2]>>> | undefined;
const gateway = new GrantModelDataGateway({
  generate: async () => { throw new Error("not used"); },
  diagnoseHierarchical: async (_prepared, _checkpoint, imageAdmission) => {
    admitted = await imageAdmission!();
    return {} as never;
  },
}, undefined, service, {
  createTemporaryReadUrl: async () => "https://example.test/not-used",
  readBytes: async () => assetBytes,
});
const prepared = await gateway.prepareDiagnosticHierarchicalInput({
  documentId,
  taskId: "diagnostic-test",
  snapshot,
  inputMode: "full_document",
  inputSectionIds: [sectionId],
  inputNodeIds: [nodeId],
  fundingCategory: "青年科学基金项目",
  priorFindings: [],
  sourceRevisionId: revision1,
});
await gateway.executeDiagnosticHierarchicalInput(documentId, prepared);
assert.equal(admitted?.coverage.mode, "multimodal");
assert.equal(admitted?.coverage.suppliedCount, 1);
assert.equal(admitted?.images[0]?.locationRef, "N1");
assert.match(admitted?.images[0]?.dataUrl ?? "", /^data:image\/png;base64,/);

await assert.rejects(() => service.authorize({
  documentId,
  expectedAuthorizationRevision: 1,
  allowedAssetIds: ["13000000-0000-4000-8000-000000000099"],
  permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
  actorId,
}), GrantFigureAuthorizationDeniedError);

currentRevisionId = revision2;
const stale = await service.getCurrent(documentId);
assert.equal(stale.requiresRenewal, true);
assert.equal(stale.effectivePermissions.sendImageToModel, false, "A document revision change must deny cached consent.");
await assert.rejects(() => service.materializeCurrentForSemanticDiagnosis(documentId), GrantFigureAuthorizationDeniedError);

now = "2026-08-10T12:01:00.000Z";
const renewed = await service.authorize({
  documentId,
  expectedAuthorizationRevision: 1,
  allowedAssetIds: [assetId],
  permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
  actorId,
});
assert.equal(renewed.authorization?.sourceRevisionId, revision2);
assert.equal(renewed.authorization?.authorizationRevision, 2);

now = "2026-08-10T12:02:00.000Z";
const revoked = await service.revoke({ documentId, expectedAuthorizationRevision: 2, actorId });
assert.equal(revoked.authorization?.authorizationRevision, 3);
assert.equal(revoked.effectivePermissions.sendImageToModel, false);
assert.ok(revoked.authorization?.revokedAt);

console.log("Grant figure model authorization contracts passed.");
