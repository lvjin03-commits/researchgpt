import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SupabaseGrantDocumentMemoryRepository } from "../lib/grants/infrastructure/supabase/supabase-grant-document-memory-repository.ts";

const snapshot = {
  schemaVersion: "grant-document-memory-v1" as const, memoryId: randomUUID(), documentId: randomUUID(),
  sourceRevisionId: randomUUID(), contextHash: "a".repeat(64), memoryHash: "b".repeat(64),
  policyVersion: "memory-v1", provider: "openai" as const, modelId: "gpt-test",
  builtAt: new Date().toISOString(), overview: "完整概览", sections: [], items: [],
  coverage: { sectionCount: 0, nodeCount: 0, coveredSectionCount: 0, coveredNodeCount: 0, complete: true as const },
  usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 }, providerRequestIds: ["req-1"],
};
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const client = { rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args });
  return { data: name === "save_grant_document_memory" ? snapshot : snapshot, error: null };
} };
const repository = new SupabaseGrantDocumentMemoryRepository(client, randomUUID());
assert.equal((await repository.save(snapshot)).memoryId, snapshot.memoryId);
assert.equal((await repository.findReusable({ documentId: snapshot.documentId,
  sourceRevisionId: snapshot.sourceRevisionId, contextHash: snapshot.contextHash,
  policyVersion: snapshot.policyVersion }))?.memoryHash, snapshot.memoryHash);
assert.deepEqual(calls.map((call) => call.name), ["save_grant_document_memory", "find_reusable_grant_document_memory"]);

const migration = await readFile(new URL("../supabase/migrations/072_grant_document_memories.sql", import.meta.url), "utf8");
assert.match(migration, /UNIQUE \(document_id, source_revision_id, context_hash, policy_version\)/);
assert.match(migration, /document\.owner_id=p_owner_id/);
assert.match(migration, /revision\.revision_id=v_revision_id/);
assert.match(migration, /ON CONFLICT\(document_id,source_revision_id,context_hash,policy_version\) DO NOTHING/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON public\.grant_document_memories FROM PUBLIC,anon,authenticated/);
console.log("Grant document memory persistence contracts passed.");
