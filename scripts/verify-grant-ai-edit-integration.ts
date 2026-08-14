import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sessionMigration = read("supabase/migrations/053_grant_ai_edit_sessions.sql");
const webMigration = read("supabase/migrations/054_grant_web_source_snapshots.sql");
for (const token of ["grant_ai_edit_sessions", "complete_grant_ai_edit_turn", "mark_grant_ai_edit_candidate_needs_repair", "ENABLE ROW LEVEL SECURITY", "TO service_role"]) assert.ok(sessionMigration.includes(token), token);
for (const token of ["grant_web_search_sessions", "grant_web_source_snapshots", "save_grant_web_source_snapshots", "ENABLE ROW LEVEL SECURITY", "TO service_role"]) assert.ok(webMigration.includes(token), token);
assert.ok(!sessionMigration.includes(" TO authenticated"));
assert.ok(!webMigration.includes(" TO authenticated"));
const config = read("lib/grants/server/config.ts");
assert.ok(config.includes("GRANT_AI_EDIT_SESSION_DATABASE_SCHEMA"));
assert.ok(config.includes('=== "053"'));
for (const route of [
  "app/api/grants/documents/[id]/edit-sessions/route.ts",
  "app/api/grants/documents/[id]/edit-sessions/[sessionId]/route.ts",
  "app/api/grants/documents/[id]/edit-sessions/[sessionId]/turns/route.ts",
  "app/api/grants/documents/[id]/edit-sessions/[sessionId]/apply/route.ts",
]) {
  const source = read(route);
  assert.ok(source.includes("requireGrantAiEditSessionRequestContext"));
  assert.ok(source.includes('"Cache-Control": "no-store"'));
}
console.log("Grant AI edit persistence and API integration contracts verified.");

