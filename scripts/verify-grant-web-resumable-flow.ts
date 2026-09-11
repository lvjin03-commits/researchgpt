import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyGrantWebCheckpointArtifact, GrantWebResumableFlow } from "../lib/grants/application/grant-web-resumable-flow.ts";
import { deterministicGrantWebArtifactManifest, revalidateGrantWebCheckpoint } from "../lib/grants/web-sources/resumable-checkpoint.ts";
import type { GrantWebResumableCheckpoint } from "../lib/grants/web-sources/resumable-checkpoint.ts";

const hash = (character: string) => character.repeat(64);
let checkpoint: GrantWebResumableCheckpoint = { schemaVersion: 1 as const, documentId: randomUUID(), turnId: randomUUID(),
  assistantSessionId: randomUUID(), question: "What changed?",
  sourceRevision: 1, contextHash: hash("a"), authorizationFingerprint: hash("b"),
  query: null, search: null, assessment: null, answer: null };
const flow = new GrantWebResumableFlow();
assert.equal(flow.next({ checkpoint }), "query_rewrite");
checkpoint = applyGrantWebCheckpointArtifact(checkpoint, { operation: "query_rewrite", value: { query: "zinc battery dendrite" } });
assert.equal(flow.next({ checkpoint }), "search_query");
const sourceId = randomUUID();
const source = { schemaVersion: 1 as const, sourceId, providerId: "openai_web_search" as const,
  providerRecordId: null, canonicalUrl: "https://example.edu/paper", title: "Paper", snippet: "Relevant result.",
  publishedAt: null, retrievedAt: new Date().toISOString(), contentFingerprint: hash("c"),
  classification: { qualityTier: "university_research" as const, registryVersion: "v1", ruleId: "edu", reason: "domain_rule" as const } };
checkpoint = applyGrantWebCheckpointArtifact(checkpoint, { operation: "search_query", value: { searchAuditId: randomUUID(), sources: [source] } });
assert.equal(flow.next({ checkpoint, deliverExisting: true }), "existing_results_delivery");
assert.equal(flow.deliverySources(checkpoint).length, 1);
const refreshed = revalidateGrantWebCheckpoint({ checkpoint, sourceRevision: 2,
  contextHash: hash("d"), authorizationFingerprint: hash("e") });
assert.equal(refreshed.checkpoint.search?.sources.length, 1, "public search artifacts remain reusable");
assert.deepEqual(refreshed.invalidated, ["assessment", "answer"]);
assert.deepEqual(deterministicGrantWebArtifactManifest(refreshed.checkpoint), {
  searchedCount: 1, sourceFingerprints: [hash("c")], assessmentAvailable: false, answerAvailable: false,
});
console.log("Grant web resumable checkpoints and existing-results delivery path passed.");
