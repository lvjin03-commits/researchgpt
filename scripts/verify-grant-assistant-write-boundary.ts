import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveGrantModelOperationPolicy } from "../lib/grants/model-execution/operation-registry.ts";

async function read(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [service, route, panel, editPanel, answerContract, registry, provider] = await Promise.all([
  read("lib/grants/application/grant-assistant-chat-service.ts"),
  read("app/api/grants/documents/[id]/assistant/chat/route.ts"),
  read("components/grants/grant-assistant-chat-panel.tsx"),
  read("components/grants/grant-ai-edit-session-panel.tsx"),
  read("lib/grants/assistant/answer-contract.ts"),
  read("lib/grants/model-execution/operation-registry.ts"),
  read("lib/grants/infrastructure/model/openai-grant-ai-model.ts"),
]);

assert.match(service, /Pick<GrantRevisionService, "getDocument" \| "getRevision">/);
assert.match(service, /Pick<GrantModelDataGateway, "answerAssistantChat" \| "validateAssistantDocumentSelections">/);
assert.doesNotMatch(service, /commitRevision|restoreRevision|patchService|applyActiveCandidate/);
assert.match(route, /assistantChat\.answer/);
assert.doesNotMatch(route, /editSessions|patches|commitRevision/);
assert.match(panel, /\/assistant\/chat/);
assert.doesNotMatch(panel, /\/edit-sessions|\/patches|\/apply/);
assert.match(panel, /onClick=\{\(\) => setInput\(question\)\}/);
assert.match(answerContract, /suggestedActions: z\.tuple\(\[\]\)/);
assert.match(editPanel, /onClick=\{\(\) => void apply\(candidate\)\}/);
assert.match(editPanel, />应用到正文<\/button>/);
assert.doesNotMatch(registry, /export const GRANT_EDIT_CANDIDATE_EXPLAIN/);
assert.doesNotMatch(provider, /explainCandidate|grant_candidate_explanation/);
assert.throws(
  () => resolveGrantModelOperationPolicy({ operation: "grant.edit_candidate.explain" as never, configuredGrantModelId: "gpt-test" }),
  /not registered/,
);

console.log("Grant assistant no-write and explicit-action boundaries passed.");
