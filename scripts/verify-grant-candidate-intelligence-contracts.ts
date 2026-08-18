import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [decision, impactAnalysis, domainContracts, implementationPlan, prChecklist] =
  await Promise.all([
    read("docs/grants/DECISIONS/0038-intelligence-does-not-own-operation-routing.md"),
    read("docs/grants/IMPACT-ANALYSES/0038-intelligent-candidate-conversation-contract.md"),
    read("docs/grants/DOMAIN-CONTRACTS.md"),
    read("docs/grants/IMPLEMENTATION-PLAN.md"),
    read("docs/grants/PR-CHECKLIST.md"),
  ]);

for (const source of [decision, impactAnalysis, domainContracts]) {
  assert.match(source, /grant\.assistant\.chat/);
  assert.match(source, /explicit user action|user click/i);
  assert.match(source, /no parallel (automatic-)?summary|no second summary/i);
  assert.match(source, /CandidateExplanation/);
}

assert.match(impactAnalysis, /suggested_action_stale/);
assert.match(impactAnalysis, /focus: none/);
assert.match(impactAnalysis, /currentlyAuthorized: boolean/);
assert.match(impactAnalysis, /one initial call plus at most one controlled\s+repair/);
assert.match(impactAnalysis, /A cache hit makes no provider call/);
assert.match(impactAnalysis, /evidenceAuthorizationFingerprint/);
assert.match(impactAnalysis, /context_budget_exceeded/);
assert.match(impactAnalysis, /Current question, focus identity, Candidate, Diff, blocking\s+issues and safety policy are non-droppable/);

assert.match(domainContracts, /Free-text submission without a preceding explicit user action/);
assert.match(domainContracts, /Ignored ambiguity|If the user ignores the choices/i);
assert.match(domainContracts, /Candidate-local input behavior defaults to `ask`/);
assert.match(domainContracts, /Cache hits do not\s+call a provider/);
assert.match(domainContracts, /`grant-candidate-diff-v1` is the sole Candidate Diff authority/);
assert.match(domainContracts, /UTF-16 code-unit offsets/);
assert.match(domainContracts, /Duplicate paragraph text is never assigned an inferred move identity/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 1 Status/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 2 Status/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 3 Status/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 4 Status/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 5 Status/);
assert.match(implementationPlan, /Candidate Conversation Intelligence Step 6 Status/);
assert.match(implementationPlan, /GRANT_CANDIDATE_EXPLANATION_ENABLED=true/);
assert.match(implementationPlan, /exact schema marker `058`/);
assert.match(implementationPlan, /no Diff implementation, Operation registration, model\s+call, cache table, migration or UI control is added/i);
assert.match(prChecklist, /semantic intent never selects an Operation/);
assert.match(prChecklist, /Candidate card summary and expanded explanation project the same stored/);

console.log("Grant candidate intelligence contract verification passed.");
