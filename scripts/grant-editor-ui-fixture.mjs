import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const [action, fixturePath] = process.argv.slice(2);
if (!fixturePath || !["create", "cleanup"].includes(action)) {
  throw new Error("Usage: node scripts/grant-editor-ui-fixture.mjs <create|cleanup> <fixture-path>");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

if (action === "create") {
  const runId = `${Date.now()}-${randomUUID()}`;
  const email = `grant-ui-${runId}@example.com`;
  const password = `Gu-${randomUUID()}-aA1!`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "grant-editor-ui-verification", runId },
  });
  if (error || !data.user) {
    throw new Error(`Temporary UI user creation failed: ${error?.message ?? "missing user"}`);
  }
  await writeFile(fixturePath, JSON.stringify({ userId: data.user.id, email, password }), {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log("Temporary Grant editor UI user created.");
}

if (action === "cleanup") {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const { data: documents, error: documentsError } = await client
    .from("grant_documents")
    .select("document_id")
    .eq("owner_id", fixture.userId);
  if (documentsError) throw new Error(`Temporary UI document lookup failed: ${documentsError.message}`);
  const documentIds = (documents ?? []).map((document) => document.document_id);
  const { error } = await client.auth.admin.deleteUser(fixture.userId);
  if (error) throw new Error(`Temporary UI user cleanup failed: ${error.message}`);
  const checks = await Promise.all([
    client.from("grant_documents").select("document_id", { count: "exact", head: true }).eq("owner_id", fixture.userId),
    client.from("grant_template_snapshots").select("template_snapshot_id", { count: "exact", head: true }).eq("owner_id", fixture.userId),
    documentIds.length
      ? client.from("grant_document_revisions").select("revision_id", { count: "exact", head: true }).in("document_id", documentIds)
      : Promise.resolve({ count: 0, error: null }),
    documentIds.length
      ? client.from("grant_audit_events").select("audit_event_id", { count: "exact", head: true }).in("document_id", documentIds)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const check of checks) {
    if (check.error) throw new Error(`Temporary UI cleanup verification failed: ${check.error.message}`);
    if (check.count !== 0) throw new Error(`Temporary UI rows remain after cleanup (count=${check.count}).`);
  }
  await unlink(fixturePath);
  console.log("Temporary Grant editor UI user and cascaded data removed.");
}
