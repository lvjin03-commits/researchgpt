import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantAssistantAnswerSchema } from "../lib/grants/assistant/answer-contract.ts";
import { assembleGrantWebGroundedAnswer, GrantWebGroundingError, hasExcessiveGrantWebSnippetOverlap } from "../lib/grants/web-sources/grounded-answer-assembler.ts";
import { createGrantWebSourceRecord } from "../lib/grants/web-sources/source-record.ts";

const makeSource = (input: { url: string; title: string; snippet: string }) => createGrantWebSourceRecord({
  sourceId: randomUUID(), providerId: "openai_web_search", url: input.url,
  title: input.title, snippet: input.snippet, retrievedAt: "2026-09-08T12:00:00.000Z",
});
const sourceA = makeSource({ url: "https://lab.example.edu/a", title: "Interface review", snippet: "Studies report that solvation structure influences zinc deposition behavior and interfacial stability under several electrolyte conditions." });
const sourceB = makeSource({ url: "https://agency.example.gov/report", title: "Official energy report", snippet: "The report identifies safety and cycle life as important constraints for stationary energy storage." });
const sourceC = makeSource({ url: "https://blog.example/post", title: "Unrelated page", snippet: "An unrelated discussion of consumer electronics." });
const assessments = { assessments: [
  { sourceId: sourceA.sourceId, disposition: "recommended", reason: "Directly relevant to zinc interfacial behavior." },
  { sourceId: sourceB.sourceId, disposition: "recommended", reason: "Relevant to application significance." },
  { sourceId: sourceC.sourceId, disposition: "excluded", reason: "Not relevant to the scientific question." },
] };
const result = assembleGrantWebGroundedAnswer({ sources: [sourceA, sourceB, sourceC], assessmentProposal: assessments, answerProposal: { claims: [
  { claimId: randomUUID(), statement: "已有研究将溶剂化环境与锌沉积行为及界面稳定性联系起来。", sourceIds: [sourceA.sourceId] },
  { claimId: randomUUID(), statement: "安全性和循环寿命是储能应用需要回应的共同约束。", sourceIds: [sourceB.sourceId] },
] } });
assert.equal(result.answer.grounding, "evidence_grounded");
assert.equal(result.answer.citations.length, 2);
assert.ok(result.answer.citations.every((citation) => citation.sourceType === "web_source"));
assert.deepEqual(result.answer.citations.map((citation) => citation.url), [sourceA.canonicalUrl, sourceB.canonicalUrl]);
assert.equal(result.searchedCount, 3);
assert.equal(result.recommendedCount, 2);
assert.equal(result.excludedCount, 1);
assert.match(result.answer.content, /\[W1\]/u);
GrantAssistantAnswerSchema.parse(result.answer);

assert.throws(() => assembleGrantWebGroundedAnswer({ sources: [sourceA, sourceB, sourceC], assessmentProposal: assessments, answerProposal: { claims: [
  { claimId: randomUUID(), statement: "Unsupported", sourceIds: [sourceC.sourceId] },
] } }), (error: unknown) => error instanceof GrantWebGroundingError && error.category === "claim_reference_invalid");
assert.throws(() => assembleGrantWebGroundedAnswer({ sources: [sourceA, sourceB], assessmentProposal: { assessments: assessments.assessments.slice(0, 1) }, answerProposal: { claims: [] } }),
  (error: unknown) => error instanceof GrantWebGroundingError && error.category === "assessment_invalid");
assert.throws(() => assembleGrantWebGroundedAnswer({ sources: [sourceA], assessmentProposal: { assessments: [{ sourceId: sourceA.sourceId, disposition: "recommended", reason: "relevant" }] }, answerProposal: { claims: [
  { claimId: randomUUID(), statement: sourceA.snippet, sourceIds: [sourceA.sourceId] },
] } }), (error: unknown) => error instanceof GrantWebGroundingError && error.category === "claim_copying_detected");
assert.equal(hasExcessiveGrantWebSnippetOverlap("A genuinely paraphrased conclusion about interface control.", sourceA.snippet), false);

console.log("Grant web relevance coverage, source binding, snippet-overlap and assistant answer assembly verified offline.");
