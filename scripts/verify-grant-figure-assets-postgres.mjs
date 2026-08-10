import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is required.");
const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nE0AAAAASUVORK5CYII=", "base64");
const imageHash = createHash("sha256").update(imageBytes).digest("hex");

const runId = `${Date.now()}-${randomUUID()}`;
let userId;
let documentId;
let objectPath;
try {
  const { data: existingUsers, error: listError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`Temporary user preflight failed: ${listError.message}`);
  for (const user of existingUsers.users.filter((candidate) =>
    candidate.user_metadata?.purpose === "grant-figure-atomic-verification")) {
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Stale figure verification user cleanup failed: ${error.message}`);
  }
  const { data, error } = await client.auth.admin.createUser({
    email: `grant-figure-${runId}@example.com`,
    password: `Gf-${randomUUID()}-aA1!`,
    email_confirm: true,
    user_metadata: { purpose: "grant-figure-atomic-verification", runId },
  });
  if (error || !data.user) throw new Error(`Temporary user creation failed: ${error?.message ?? "missing user"}`);
  userId = data.user.id;
  documentId = randomUUID();
  const revisionId = randomUUID();
  const assetId = randomUUID();
  const sectionId = randomUUID();
  const nodeId = randomUUID();
  const snapshot = {
    schemaVersion: "grant-canonical-v1",
    title: "Figure atomic verification",
    sections: [{ sectionId, semanticRole: "verification", title: "正文", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "figure", content: { assetId, altText: "测试图片" } }],
  };
  objectPath = `${userId}/grant-figure-assets/${assetId}/${imageHash}.png`;
  const { error: uploadError } = await client.storage.from("chat-attachments").upload(objectPath, imageBytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (uploadError) throw new Error(`Temporary figure upload failed: ${uploadError.message}`);
  const figureAsset = {
    assetId,
    documentId,
    sourceRevisionId: revisionId,
    sourceDocumentChecksum: "a".repeat(64),
    contentHash: imageHash,
    mediaType: "image/png",
    byteSize: imageBytes.byteLength,
    widthPx: 1,
    heightPx: 1,
    storage: { bucket: "chat-attachments", path: objectPath },
    anchor: {
      sourceOrdinal: 0, relationshipId: "rId1", partName: "word/media/image1.png", anchorKind: "inline",
      sectionLocalKey: "section-1", precedingBlockLocalKey: null, followingBlockLocalKey: null,
      caption: { text: null, source: "none" },
    },
    createdAt: new Date().toISOString(),
  };
  const { error: rpcError } = await client.rpc("create_grant_document_foundation", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_title: snapshot.title,
    p_template_snapshot_id: randomUUID(),
    p_template_key: "figure-verification",
    p_template_version: "1",
    p_template_rules: { testOnly: true },
    p_template_checksum: digest({ testOnly: true }),
    p_revision_id: revisionId,
    p_content_hash: digest(snapshot),
    p_snapshot: snapshot,
    p_actor_id: userId,
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId },
    p_figure_assets: [figureAsset],
  });
  if (rpcError) throw new Error(`Atomic figure foundation failed: ${rpcError.message}`);
  const { data: rows, error: selectError } = await client.from("grant_imported_figure_assets")
    .select("asset_id,document_id,source_revision_id,content_hash,anchor")
    .eq("asset_id", assetId);
  if (selectError) throw new Error(`Figure verification read failed: ${selectError.message}`);
  assert(rows?.length === 1, "Exactly one imported figure asset must be committed.");
  assert(rows[0].document_id === documentId && rows[0].source_revision_id === revisionId, "Figure identity binding is invalid.");
  assert(rows[0].anchor?.sourceOrdinal === 0, "Figure source order was not preserved.");
  const { data: projectedAssets, error: projectionError } = await client.rpc("list_grant_imported_figure_assets", {
    p_owner_id: userId,
    p_document_id: documentId,
  });
  if (projectionError) throw new Error(`Owner-scoped figure projection failed: ${projectionError.message}`);
  assert(projectedAssets?.length === 1, "Owner-scoped figure projection did not return the stored asset.");
  assert(projectedAssets[0].assetId === assetId, "Figure projection changed program-owned asset identity.");
  const { data: deniedAssets, error: deniedError } = await client.rpc("list_grant_imported_figure_assets", {
    p_owner_id: randomUUID(),
    p_document_id: documentId,
  });
  if (deniedError) throw new Error(`Cross-owner figure projection probe failed: ${deniedError.message}`);
  assert(deniedAssets?.length === 0, "Figure metadata leaked across owners.");

  const { data: signed, error: signedError } = await client.storage.from("chat-attachments")
    .createSignedUrl(objectPath, 60);
  if (signedError || !signed?.signedUrl) throw new Error(`Temporary figure URL failed: ${signedError?.message ?? "missing URL"}`);
  const downloaded = Buffer.from(await (await fetch(signed.signedUrl)).arrayBuffer());
  assert(createHash("sha256").update(downloaded).digest("hex") === imageHash, "Signed figure bytes failed integrity verification.");
  console.log(JSON.stringify({ migrations: ["048_grant_imported_figure_assets", "049_grant_figure_workspace_read"], atomicCommit: true, assetCount: rows.length, ownerScopedRead: true, signedRead: true }, null, 2));
} finally {
  if (objectPath) {
    const { error } = await client.storage.from("chat-attachments").remove([objectPath]);
    if (error) throw new Error(`Temporary figure object cleanup failed: ${error.message}`);
  }
  if (userId) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Temporary user cleanup failed: ${error.message}`);
  }
  if (documentId) {
    const { count, error } = await client.from("grant_imported_figure_assets")
      .select("asset_id", { count: "exact", head: true }).eq("document_id", documentId);
    if (error) throw new Error(`Figure cleanup verification failed: ${error.message}`);
    assert(count === 0, "Temporary figure rows remain after cleanup.");
  }
}
