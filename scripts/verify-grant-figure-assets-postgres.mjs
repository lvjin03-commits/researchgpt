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

const runId = `${Date.now()}-${randomUUID()}`;
let userId;
let documentId;
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
  const figureAsset = {
    assetId,
    documentId,
    sourceRevisionId: revisionId,
    sourceDocumentChecksum: "a".repeat(64),
    contentHash: "b".repeat(64),
    mediaType: "image/png",
    byteSize: 64,
    widthPx: 8,
    heightPx: 8,
    storage: { bucket: "chat-attachments", path: `${userId}/grant-figure-assets/${assetId}/${"b".repeat(64)}.png` },
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
  console.log(JSON.stringify({ migration: "048_grant_imported_figure_assets", atomicCommit: true, assetCount: rows.length }, null, 2));
} finally {
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
