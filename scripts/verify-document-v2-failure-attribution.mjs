import assert from "node:assert/strict";
import {
  analyzeDocumentV2FailureAttribution,
  documentV2FailureAttributionCsv,
} from "./lib/document-v2-failure-attribution.mjs";

const jobs = [
  { id: "job-component", status: "failed", stage: "content_generation", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:01:00Z" },
  { id: "job-planning", status: "completed", stage: "delivery", created_at: "2026-08-02T00:00:00Z", updated_at: "2026-08-02T00:01:00Z" },
  { id: "job-figure", status: "failed", stage: "asset_generation", created_at: "2026-08-03T00:00:00Z", updated_at: "2026-08-03T00:01:00Z" },
];
const baseExecution = {
  provider: "deepseek", resolved_model_id: "deepseek-v4-pro", input_tokens: 100,
  output_tokens: 50, reasoning_tokens: 0, calculated_cost_usd: 0.01,
};
const executions = [
  { ...baseExecution, execution_key: "component-root-1", job_id: "job-component", component_key: "section-01", operation: "component.generate", status: "validation_failed", attempt_number: 1, parent_execution_key: null, failure_category: "schema_validation_failed" },
  { ...baseExecution, execution_key: "component-root-2", job_id: "job-component", component_key: "section-01", operation: "component.generate", status: "succeeded", attempt_number: 1, parent_execution_key: null, failure_category: null },
  { ...baseExecution, execution_key: "planning-root", job_id: "job-planning", component_key: "document-section-index", operation: "outline.section_index", status: "validation_failed", attempt_number: 1, parent_execution_key: null, failure_category: "schema_validation_failed" },
  { ...baseExecution, execution_key: "planning-repair", job_id: "job-planning", component_key: "document-section-index", operation: "outline.section_index", status: "succeeded", attempt_number: 2, parent_execution_key: "planning-root", failure_category: null },
];
const events = [
  {
    job_id: "job-figure",
    stage: "asset_generation",
    status: "failed",
    event_payload: {
      operation: "component.failed",
      category: "image",
      correlationId: "job-figure:section-02",
      metadata: { errorCode: "figure_asset_generation_failed" },
    },
  },
];

const report = analyzeDocumentV2FailureAttribution({
  jobs, executions, events, generatedAt: "2026-08-06T00:00:00.000Z", query: { fixture: true },
});
assert.equal(report.sourceCounts.jobs, 3);
assert.equal(report.summary.component.structuredFailureCount, 1);
assert.equal(report.summary.component.structuredFailureWithoutInternalRecoveryCount, 1);
assert.equal(report.summary.component.outerRetryJobCount, 1);
assert.equal(report.summary.planning.internalRecoveryExecutionCount, 1);
assert.equal(report.summary.planning.affectedJobCount, 1);
assert.equal(report.summary.figures.terminalFailureEventCount, 1);
assert.equal(report.summary.figures.affectedJobCount, 1);
assert.equal(report.summary.providerCostUsd, 0.04);
const componentJob = report.jobs.find((job) => job.jobId === "job-component");
assert.equal(componentJob.component.outerRetryGroupCount, 1);
assert.deepEqual(componentJob.component.affectedComponentKeys, ["section-01"]);
const csv = documentV2FailureAttributionCsv(report);
assert.match(csv, /job-component/);
assert.match(csv, /section-01/);
assert.equal(csv.split("\n")[0].includes("provider_cost_usd"), true);
console.log("Document v2 failure attribution tests passed.");
