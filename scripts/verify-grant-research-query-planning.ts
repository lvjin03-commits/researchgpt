import assert from "node:assert/strict";
import { assembleGrantResearchQueryPlan, decideGrantResearchNextStep } from "../lib/grants/web-sources/research-query-planning.ts";

const ids = [
  "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004",
];
let cursor = 0;
const plan = assembleGrantResearchQueryPlan({ createId: () => ids[cursor++]!, providerResult: {
  schemaVersion: 1, queries: [
    { queryRef: "Q1", dimension: "recent_review", query: "aqueous zinc battery electrolyte review 2025 2026", purpose: "Map recent directions." },
    { queryRef: "Q2", dimension: "mechanism", query: "zinc secondary solvation sheath mechanism", purpose: "Find molecular mechanisms." },
    { queryRef: "Q3", dimension: "application_specific", query: "quaternary ammonium deep eutectic zinc electrolyte", purpose: "Match the application route." },
    { queryRef: "Q4", dimension: "dynamic_interface", query: "electric field dynamic zinc electrolyte interface", purpose: "Test operating-state behavior." },
  ],
} });
assert.equal(plan.queries.length, 4);
assert.equal(plan.queries[0]?.queryId, ids[0]);

const first = decideGrantResearchNextStep({ plan, completedQueryIds: [], coverage: [] });
assert.equal(first.decision, "execute_query");
if (first.decision === "execute_query") assert.equal(first.query.queryId, ids[0]);

const sufficient = decideGrantResearchNextStep({ plan, completedQueryIds: ids.slice(0, 3), coverage: [
  { dimension: "recent_review", executed: true, recommendedSourceCount: 2, structuredAbstractCount: 1, recentSourceCount: 1, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "mechanism", executed: true, recommendedSourceCount: 2, structuredAbstractCount: 1, recentSourceCount: 1, quantitativeFindingCount: 1, comparisonComplete: true },
  { dimension: "application_specific", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 1, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
] });
assert.deepEqual(sufficient, { decision: "stop", reason: "evidence_sufficient", limitations: [] },
  "sufficient evidence must stop before consuming the remaining planned query");

const incomplete = decideGrantResearchNextStep({ plan, completedQueryIds: ids.slice(0, 3), coverage: [
  { dimension: "recent_review", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 1, recentSourceCount: 1, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "mechanism", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 1, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "application_specific", executed: true, recommendedSourceCount: 0, structuredAbstractCount: 0, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
] });
assert.equal(incomplete.decision, "execute_query");
if (incomplete.decision === "execute_query") assert.equal(incomplete.query.queryId, ids[3]);

const exhausted = decideGrantResearchNextStep({ plan, completedQueryIds: ids, coverage: [
  { dimension: "recent_review", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 1, recentSourceCount: 1, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "mechanism", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 1, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "application_specific", executed: true, recommendedSourceCount: 0, structuredAbstractCount: 0, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
  { dimension: "dynamic_interface", executed: true, recommendedSourceCount: 1, structuredAbstractCount: 0, recentSourceCount: 0, quantitativeFindingCount: 0, comparisonComplete: true },
] });
assert.equal(exhausted.decision, "stop");
if (exhausted.decision === "stop") {
  assert.equal(exhausted.reason, "plan_exhausted");
  assert(exhausted.limitations.length > 0, "partial research delivery must disclose evidence limitations");
}

assert.throws(() => assembleGrantResearchQueryPlan({ createId: () => ids[0]!, providerResult: {
  schemaVersion: 1, queries: [
    { queryRef: "Q1", dimension: "recent_review", query: "same query", purpose: "one" },
    { queryRef: "Q2", dimension: "mechanism", query: "same query", purpose: "two" },
    { queryRef: "Q3", dimension: "application_specific", query: "different query", purpose: "three" },
  ],
} }), /textually distinct/u);

console.log("Research query planning and deterministic evidence-stop policy verified offline.");

