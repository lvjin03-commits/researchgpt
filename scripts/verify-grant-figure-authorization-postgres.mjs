import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service configuration is required.");
const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceDocumentId = "fdafee12-4327-413a-94f4-85df77a8542b";
const { data: source, error: sourceError } = await client.from("grant_documents")
  .select("owner_id").eq("document_id", sourceDocumentId).single();
if (sourceError || !source) throw new Error(`Owner lookup failed: ${sourceError?.message ?? "missing"}`);

const ownerId = source.owner_id;
const documentId = randomUUID();
const revision1 = randomUUID();
const revision2 = randomUUID();
const templateSnapshotId = randomUUID();
const assetId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const authorizationId = randomUUID();
const snapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "Figure authorization database probe",
  sections: [{ sectionId, semanticRole: "probe", title: "Probe", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "figure", content: { assetId, altText: "probe", caption: "Figure 1" } }],
};
const asset = {
  assetId,
  documentId,
  sourceRevisionId: revision1,
  sourceDocumentChecksum: "a".repeat(64),
  contentHash: "b".repeat(64),
  mediaType: "image/png",
  byteSize: 100,
  widthPx: 100,
  heightPx: 50,
  storage: { bucket: "chat-attachments", path: `${ownerId}/grant-figure-auth-probe/${assetId}.png` },
  anchor: {
    sourceOrdinal: 0,
    relationshipId: "rId1",
    partName: "word/media/image1.png",
    anchorKind: "inline",
    sectionLocalKey: "probe",
    precedingBlockLocalKey: null,
    followingBlockLocalKey: null,
    caption: { text: "Figure 1", source: "word_caption" },
  },
  createdAt: new Date().toISOString(),
};

try {
  const { error: createError } = await client.rpc("create_grant_document_foundation", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_title: snapshot.title,
    p_template_snapshot_id: templateSnapshotId,
    p_template_key: "figure-authorization-probe",
    p_template_version: "1",
    p_template_rules: { probe: true },
    p_template_checksum: hash({ probe: true }),
    p_revision_id: revision1,
    p_content_hash: hash(snapshot),
    p_snapshot: snapshot,
    p_actor_id: ownerId,
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { probe: true },
    p_figure_assets: [asset],
  });
  if (createError) throw createError;

  const authorization1 = {
    authorizationId,
    documentId,
    sourceRevisionId: revision1,
    authorizationRevision: 1,
    allowedAssetIds: [assetId],
    permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
    expiresAt: null,
    revokedAt: null,
    updatedBy: ownerId,
    updatedAt: new Date().toISOString(),
  };
  const { data: saved1, error: save1Error } = await client.rpc("save_grant_figure_model_authorization", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_expected_authorization_revision: 0,
    p_authorization: authorization1,
  });
  if (save1Error) throw save1Error;
  assert.equal(saved1.authorizationRevision, 1);

  const { data: privateRead } = await client.rpc("get_grant_figure_model_authorization", {
    p_owner_id: randomUUID(), p_document_id: documentId,
  });
  assert.equal(privateRead, null, "A different owner must not read figure authorization.");

  const { error: conflictError } = await client.rpc("save_grant_figure_model_authorization", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_expected_authorization_revision: 0,
    p_authorization: authorization1,
  });
  assert.match(conflictError?.message ?? "", /figure authorization revision conflict/i);

  const { data: committed, error: commitError } = await client.rpc("commit_grant_document_revision", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_expected_revision_id: revision1,
    p_revision_id: revision2,
    p_content_hash: hash({ ...snapshot, revision: 2 }),
    p_snapshot: snapshot,
    p_actor_id: ownerId,
    p_actor_kind: "user",
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { probe: true },
  });
  if (commitError) throw commitError;
  assert.equal(committed, true);

  const authorization2 = { ...authorization1, sourceRevisionId: revision2, authorizationRevision: 2, updatedAt: new Date().toISOString() };
  const { data: saved2, error: save2Error } = await client.rpc("save_grant_figure_model_authorization", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_expected_authorization_revision: 1,
    p_authorization: authorization2,
  });
  if (save2Error) throw save2Error;
  assert.equal(saved2.sourceRevisionId, revision2);

  const revokedAt = new Date().toISOString();
  const revoked = {
    ...authorization2,
    authorizationRevision: 3,
    permissions: { sendImageToModel: false, useForSemanticDiagnosis: false },
    revokedAt,
    updatedAt: revokedAt,
  };
  const { data: saved3, error: save3Error } = await client.rpc("save_grant_figure_model_authorization", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_expected_authorization_revision: 2,
    p_authorization: revoked,
  });
  if (save3Error) throw save3Error;
  assert.equal(saved3.permissions.sendImageToModel, false);

  console.log(JSON.stringify({ migration050: true, ownerScopedRead: true, conflictProtected: true, revisionBound: true, revocation: true }, null, 2));
} finally {
  await client.from("grant_documents").delete().eq("document_id", documentId);
  await client.from("grant_template_snapshots").delete().eq("template_snapshot_id", templateSnapshotId);
}
