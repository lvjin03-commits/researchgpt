import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OpenAIGrantWebGroundingModel } from "../lib/grants/infrastructure/model/openai-grant-web-grounding-model.ts";
import { GrantWebModelError } from "../lib/grants/ports/grant-web-grounding-model.ts";
import { createGrantWebSourceRecord } from "../lib/grants/web-sources/source-record.ts";

const source = createGrantWebSourceRecord({ sourceId: randomUUID(), providerId: "openai_web_search",
  url: "https://lab.example.edu/review", title: "Interface review",
  snippet: "Electrolyte solvation is associated with zinc deposition and interface stability.",
  retrievedAt: "2026-09-08T12:00:00.000Z" });
const requests: unknown[] = [];
const outputs = [
  JSON.stringify({ query: "zinc electrolyte solvation interface stability" }),
  JSON.stringify({ assessments: [{ sourceId: source.sourceId, disposition: "recommended", reason: "Directly relevant." }] }),
  JSON.stringify({ claims: [{ claimId: randomUUID(), statement: "外部资料支持关注溶剂化环境和锌界面稳定性的联系。", sourceIds: [source.sourceId] }] }),
];
const client = { chat: { completions: { async create(input: unknown) {
  requests.push(input); return { id: `offline-${requests.length}`, choices: [{ finish_reason: "stop", message: { content: outputs.shift() } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } };
} } } };
const model = new OpenAIGrantWebGroundingModel("offline-model", "", client);
const rewrite = await model.rewriteQuery({ question: "结合申请书联网补充", admittedApplicationContext: "锌电池研究方案", attemptPurpose: "initial" });
assert.equal(rewrite.value.query, "zinc electrolyte solvation interface stability");
const assessment = await model.assess({ question: "是否相关", admittedApplicationContext: "锌电池研究方案", sources: [source], attemptPurpose: "initial" });
assert.equal(assessment.value.assessments[0]?.sourceId, source.sourceId);
const answer = await model.synthesize({ question: "给出判断", admittedApplicationContext: "锌电池研究方案", sources: [source], attemptPurpose: "initial" });
assert.deepEqual(answer.value.claims[0]?.sourceIds, [source.sourceId]);
assert.equal(requests.length, 3);
assert.ok(requests.every((request) => JSON.stringify(request).includes("untrusted data")));
assert.ok(requests.every((request) => !JSON.stringify(request).includes("OPENAI_API_KEY")));
assert.equal(answer.usage?.reasoningTokens, 1);

const invalidClient = { chat: { completions: { async create() { return { id: "bad", choices: [{ finish_reason: "stop", message: { content: "not-json" } }] }; } } } };
const invalidModel = new OpenAIGrantWebGroundingModel("offline-model", "", invalidClient);
await assert.rejects(() => invalidModel.rewriteQuery({ question: "question", admittedApplicationContext: "context", attemptPurpose: "initial" }),
  (error: unknown) => error instanceof GrantWebModelError && error.category === "structured_output_invalid");
assert.throws(() => new OpenAIGrantWebGroundingModel("", ""),
  (error: unknown) => error instanceof GrantWebModelError && error.category === "provider_unavailable");

console.log("OpenAI grant web-grounding adapter verified offline with injected responses; no provider call was made.");
