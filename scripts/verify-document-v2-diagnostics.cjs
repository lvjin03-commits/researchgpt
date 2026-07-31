const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const swc = require("next/dist/build/swc");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  const resolved = request.startsWith("@/")
    ? path.join(projectRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolved, parent, isMain, options);
};
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const output = swc.transformSync(fs.readFileSync(filename, "utf8"), {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const {
  projectDocumentJobDiagnostics,
} = require("../lib/document-v2/diagnostics/projector.ts");
const {
  sanitizeDiagnosticError,
} = require("../lib/document-v2/diagnostics/redaction.ts");

const now = new Date("2026-07-31T03:20:00.000Z");
const diagnostic = projectDocumentJobDiagnostics(
  {
    job: {
      id: "ce1f4649-04d8-4739-a0bb-0f1c8fad875d",
      status: "cancelling",
      stage: "evidence_acquisition",
      revision: 10,
      lease_owner: null,
      lease_expires_at: null,
      recovery_count: 1,
      last_heartbeat_at: null,
      created_at: "2026-07-31T03:07:45.000Z",
      updated_at: "2026-07-31T03:14:01.000Z",
    },
    events: [
      {
        sequence: 1,
        stage: "understanding",
        status: "succeeded",
        created_at: "2026-07-31T03:07:55.000Z",
        event_payload: {
          stage: "understanding",
          status: "succeeded",
          operation: "model.call.succeeded",
          createdAt: "2026-07-31T03:07:55.000Z",
          metadata: {
            inputFingerprint: "understand-fingerprint",
            calculatedCostUsd: 0.00026208,
          },
        },
      },
    ],
    executions: [
      {
        execution_key: "outline-execution",
        component_key: null,
        operation: "outline.plan",
        input_fingerprint: "outline-fingerprint",
        provider: "deepseek",
        requested_model_id: "deepseek-v4-flash",
        resolved_model_id: "deepseek-v4-flash",
        actual_model_id: null,
        provider_request_id: null,
        status: "request_started",
        attempt: 1,
        lease_expires_at: "2026-07-31T03:10:00.000Z",
        started_at: "2026-07-31T03:08:00.000Z",
        response_received_at: null,
        raw_saved_at: null,
        completed_at: null,
        failure_category: null,
        error_message: "Bearer secret-token sk-secretvalue user@example.com C:\\Users\\secret\\file.txt",
        finish_reason: null,
        choice_count: 0,
        content_state: null,
        content_length: 0,
        reasoning_content_present: false,
        reasoning_content_length: 0,
        refusal_present: false,
        tool_call_count: 0,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        raw_content_hash: "response-hash",
        sanitized_preview: "safe preview",
        provider_response_saved_at: null,
        parse_started_at: null,
        parse_completed_at: null,
        parse_status: null,
        parse_error_message: null,
        parse_error_position: null,
        candidate_count: 0,
        json_valid_candidate_count: 0,
        schema_valid_candidate_count: 0,
        repair_steps: [],
        candidate_diagnostics: [],
        parser_version: "document-json-parser-v2",
        repair_pipeline_version: "document-json-repair-v1",
        schema_version: "schema-hash",
      },
    ],
    outbox: [
      {
        id: "outbox-1",
        event_type: "job_created",
        status: "delivered",
        delivery_attempts: 1,
        next_attempt_at: "2026-07-31T03:07:45.000Z",
        delivered_at: "2026-07-31T03:07:46.000Z",
        created_at: "2026-07-31T03:07:45.000Z",
      },
    ],
  },
  now,
);

assert.equal(diagnostic.currentPosition.operation, "outline.plan");
assert.equal(diagnostic.currentPosition.derivedFrom, "model_execution");
assert.equal(diagnostic.currentBlocker.code, "cancellation_not_dispatched");
assert.equal(
  diagnostic.findings.some((item) => item.code === "model_unknown_outcome"),
  true,
);
assert.equal(diagnostic.lastDurableCheckpoint.verified, false);
assert.equal(diagnostic.codexSummary.safeResumeFrom, null);
assert.equal(diagnostic.codexSummary.duplicateRisk, false);
assert.equal(diagnostic.health.incompleteSources.includes("worker_invocations"), true);
assert.equal(diagnostic.modelExecutions[0].errorMessage.includes("secret-token"), false);
assert.equal(diagnostic.modelExecutions[0].errorMessage.includes("sk-secretvalue"), false);
assert.equal(diagnostic.modelExecutions[0].errorMessage.includes("user@example.com"), false);
assert.equal(
  sanitizeDiagnosticError("postgres://user:pass@host/db").includes("pass"),
  false,
);
assert.equal(JSON.stringify(diagnostic).includes("raw_response"), false);
assert.equal(JSON.stringify(diagnostic).includes("raw_content_encrypted"), false);
assert.equal(diagnostic.modelExecutions[0].rawContentHash, "response-hash");
assert.equal(diagnostic.modelExecutions[0].sanitizedPreview, "safe preview");

const cancellationWithDispatch = projectDocumentJobDiagnostics(
  {
    ...{
      job: diagnosticFixtureJob(),
      events: [],
      executions: [],
      outbox: [
        {
          id: "outbox-after-cancel",
          event_type: "continue_job",
          status: "pending",
          delivery_attempts: 0,
          next_attempt_at: "2026-07-31T03:14:02.000Z",
          delivered_at: null,
          created_at: "2026-07-31T03:14:02.000Z",
        },
      ],
    },
  },
  now,
);
assert.equal(
  cancellationWithDispatch.findings.some(
    (item) => item.code === "cancellation_not_dispatched",
  ),
  false,
);

console.log("Document v2 diagnostics projection tests passed.");

function diagnosticFixtureJob() {
  return {
    id: "ce1f4649-04d8-4739-a0bb-0f1c8fad875d",
    status: "cancelling",
    stage: "evidence_acquisition",
    revision: 10,
    lease_owner: null,
    lease_expires_at: null,
    recovery_count: 1,
    last_heartbeat_at: null,
    created_at: "2026-07-31T03:07:45.000Z",
    updated_at: "2026-07-31T03:14:01.000Z",
  };
}
