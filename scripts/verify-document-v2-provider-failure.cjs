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

process.env.DEEPSEEK_API_KEY = "test-only-key";
process.env.DOCUMENT_V2_RESPONSE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
  "base64",
);

const { z } = require("zod");
const {
  DocumentModelOperationError,
  ProviderDocumentTextExecutor,
} = require("../lib/document-v2-production/text-executor.ts");
const {
  protectResponseEvidence,
} = require("../lib/document-v2-production/response-evidence.ts");

class ExecutionTable {
  constructor() {
    this.rows = new Map();
  }

  from(table) {
    assert.equal(table, "document_v2_model_executions");
    return new ExecutionQuery(this);
  }
}

class ExecutionQuery {
  constructor(table) {
    this.table = table;
    this.mode = "select";
    this.filters = {};
    this.expectedStatuses = null;
    this.values = null;
  }

  select() {
    return this;
  }

  eq(field, value) {
    this.filters[field] = value;
    return this;
  }

  in(field, values) {
    assert.equal(field, "status");
    this.expectedStatuses = values;
    return this;
  }

  insert(values) {
    const key = values.execution_key;
    if (this.table.rows.has(key)) {
      return Promise.resolve({ error: { message: "duplicate" } });
    }
    this.table.rows.set(key, {
      raw_response: null,
      ...values,
    });
    return Promise.resolve({ error: null });
  }

  update(values) {
    this.mode = "update";
    this.values = values;
    return this;
  }

  async maybeSingle() {
    const key = this.filters.execution_key;
    const current = this.table.rows.get(key) ?? null;
    if (this.mode !== "update") {
      return { data: current, error: null };
    }
    if (
      !current ||
      (this.expectedStatuses &&
        !this.expectedStatuses.includes(current.status))
    ) {
      return { data: null, error: null };
    }
    const updated = { ...current, ...this.values };
    this.table.rows.set(key, updated);
    return { data: { execution_key: key }, error: null };
  }
}

function createExecutor(response) {
  const persistence = new ExecutionTable();
  const calls = { count: 0 };
  const executor = new ProviderDocumentTextExecutor(
    {
      provider: "deepseek",
      requestedModelId: "deepseek-v4-flash",
      resolvedModelId: "deepseek-v4-flash",
      maxOutputTokens: 1_000,
    },
    undefined,
    {
      supabase: persistence,
      jobId: "96ffc8b0-8fe7-438a-ac54-9ee6f3075a1a",
    },
  );
  executor.client = {
    chat: {
      completions: {
        create: async () => {
          calls.count += 1;
          return response;
        },
      },
    },
  };
  return { executor, persistence, calls };
}

async function executeCase({ operation, response, schema }) {
  const { executor, persistence } = createExecutor(response);
  let caught;
  try {
    await executor.generate({
      operation,
      schemaName: "provider_failure_test",
      schema,
      systemInstruction: "Return test JSON.",
      userInstruction: "Test.",
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  const rows = [...persistence.rows.values()];
  assert.equal(rows.length, 1);
  return { error: caught, row: rows[0] };
}

(async () => {
  const empty = await executeCase({
    operation: "outline.plan.empty",
    response: {
      id: "deepseek-empty",
      model: "deepseek-v4-flash",
      choices: [
        {
          finish_reason: "length",
          message: {
            content: null,
            reasoning_content: "internal reasoning",
            tool_calls: [],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 80 },
    },
    schema: z.object({ value: z.string() }),
  });
  assert.ok(empty.error instanceof DocumentModelOperationError);
  assert.equal(empty.error.failureCategory, "empty_structured_output");
  assert.equal(empty.row.status, "failed");
  assert.equal(empty.row.failure_category, "empty_structured_output");
  assert.equal(empty.row.finish_reason, "length");
  assert.equal(empty.row.choice_count, 1);
  assert.equal(empty.row.content_state, "null");
  assert.equal(empty.row.reasoning_content_present, true);
  assert.equal(empty.row.provider_request_id, "deepseek-empty");
  assert.ok(empty.row.response_received_at);
  assert.equal(empty.row.input_tokens, 120);
  assert.equal(empty.row.output_tokens, 80);

  const invalidJson = await executeCase({
    operation: "outline.plan.invalid_json",
    response: {
      id: "deepseek-invalid-json",
      model: "deepseek-v4-flash",
      choices: [
        {
          finish_reason: "stop",
          message: { content: "not json", tool_calls: [] },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    },
    schema: z.object({ value: z.string() }),
  });
  assert.equal(invalidJson.row.status, "failed");
  assert.equal(invalidJson.row.failure_category, "no_json_object");
  assert.equal(invalidJson.row.content_state, "present");
  assert.equal(invalidJson.row.content_length, 8);
  assert.ok(invalidJson.row.raw_content_encrypted);
  assert.ok(invalidJson.row.raw_content_hash);
  assert.equal(invalidJson.row.sanitized_preview, "not json");
  assert.ok(invalidJson.row.provider_response_saved_at);
  assert.equal(invalidJson.row.parse_status, "failed");

  const invalidSchema = await executeCase({
    operation: "outline.plan.schema",
    response: {
      id: "deepseek-invalid-schema",
      model: "deepseek-v4-flash",
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"value":1}', tool_calls: [] },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    },
    schema: z.object({ value: z.string() }),
  });
  assert.equal(invalidSchema.row.status, "validation_failed");
  assert.equal(
    invalidSchema.row.failure_category,
    "schema_validation_failed",
  );
  assert.ok(invalidSchema.row.provider_response_saved_at);
  assert.ok(invalidSchema.row.raw_content_encrypted);

  const recoverable = createExecutor({
    id: "deepseek-recovery",
    model: "deepseek-v4-flash",
    choices: [
      {
        finish_reason: "stop",
        message: { content: "not json", tool_calls: [] },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
  const recoveryInput = {
    operation: "outline.plan.recover",
    schemaName: "provider_failure_test",
    schema: z.object({ value: z.string() }),
    systemInstruction: "Return test JSON.",
    userInstruction: "Test.",
  };
  await assert.rejects(() => recoverable.executor.generate(recoveryInput));
  assert.equal(recoverable.calls.count, 1);
  const recoveryRow = [...recoverable.persistence.rows.values()][0];
  const replacement = protectResponseEvidence('{"value":"recovered"}');
  recoveryRow.raw_content_encrypted = replacement.encryptedContent;
  recoveryRow.parser_version = "older-parser";
  recoveryRow.schema_version = "older-schema";
  const recovered = await recoverable.executor.generate(recoveryInput);
  assert.deepEqual(recovered, { value: "recovered" });
  assert.equal(
    recoverable.calls.count,
    1,
    "Reparsing saved provider evidence must not call the provider again.",
  );
  const recoveredRow = [...recoverable.persistence.rows.values()][0];
  assert.equal(recoveredRow.status, "succeeded");

  const migration = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/024_document_v2_provider_observability.sql",
    ),
    "utf8",
  );
  const recoveryMigration = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/025_document_v2_response_recovery.sql",
    ),
    "utf8",
  );
  assert.match(migration, /'response_received'/);
  assert.match(migration, /finalize_document_v2_worker_failure/);
  assert.match(
    migration,
    /lease_owner IS DISTINCT FROM expected_worker_id/,
  );
  assert.match(migration, /next_status := 'paused'/);
  assert.match(migration, /current_job\.status = 'cancelling'/);
  assert.match(recoveryMigration, /raw_content_encrypted TEXT/);
  assert.match(recoveryMigration, /candidate_diagnostics JSONB/);
  assert.match(recoveryMigration, /parser_version TEXT/);
  assert.doesNotMatch(
    recoveryMigration,
    /raw_content_plaintext/i,
    "The recovery migration must not introduce plaintext provider content.",
  );
  const runtimeContracts = fs.readFileSync(
    path.join(projectRoot, "lib/document-v2/runtime/contracts.ts"),
    "utf8",
  );
  assert.match(
    runtimeContracts,
    /!\["failed", "paused"\]\.includes\(job\.status\)/,
    "A paused worker failure must remain readable through the job contract.",
  );
  assert.match(
    runtimeContracts,
    /Only a failed or paused job may contain error details\./,
  );
  assert.doesNotMatch(
    migration,
    /INSERT INTO public\.document_v2_outbox/,
    "The first observability release must not enable automatic retries.",
  );

  console.log("Document v2 provider failure tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
