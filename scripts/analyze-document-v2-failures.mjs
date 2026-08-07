import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeDocumentV2FailureAttribution,
  documentV2FailureAttributionCsv,
} from "./lib/document-v2-failure-attribution.mjs";

const PAGE_SIZE = 1_000;
const JOB_ID_BATCH_SIZE = 40;

function parseArgs(argv) {
  const options = {
    since: "30d",
    limit: 250,
    statuses: [],
    output: ".document-v2-attribution-output/report.json",
    csv: ".document-v2-attribution-output/jobs.csv",
  };
  for (const argument of argv) {
    if (argument === "--help") return { ...options, help: true };
    const [name, ...rest] = argument.split("=");
    const value = rest.join("=");
    if (name === "--since") options.since = value;
    else if (name === "--limit") options.limit = Number(value);
    else if (name === "--statuses") {
      options.statuses = value.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (name === "--output") options.output = value;
    else if (name === "--csv") options.csv = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5_000) {
    throw new Error("--limit must be an integer between 1 and 5000.");
  }
  return options;
}

function sinceIso(value) {
  const dayMatch = /^(\d+)d$/.exec(value);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (days < 1 || days > 3_650) throw new Error("--since day range must be 1d to 3650d.");
    return new Date(Date.now() - days * 86_400_000).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("--since must be an ISO timestamp or a duration such as 30d.");
  }
  return parsed.toISOString();
}

function requiredEnvironment() {
  const supabaseUrl = (
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  ).trim().replace(/\/$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  return { supabaseUrl, serviceRoleKey };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function restClient(config) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };

  async function read(endpoint, query, range) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${endpoint}?${query.toString()}`, {
      method: "GET",
      headers: {
        ...headers,
        Range: `${range.from}-${range.to}`,
        "Range-Unit": "items",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GET ${endpoint} failed (${response.status}): ${text.slice(0, 1_000)}`);
    }
    return text ? JSON.parse(text) : [];
  }

  async function readAll(endpoint, query, maximumRows = 20_000) {
    const rows = [];
    while (rows.length < maximumRows) {
      const page = await read(endpoint, query, {
        from: rows.length,
        to: Math.min(rows.length + PAGE_SIZE - 1, maximumRows - 1),
      });
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    if (rows.length >= maximumRows) {
      throw new Error(`${endpoint} exceeded the ${maximumRows}-row safety ceiling.`);
    }
    return rows;
  }

  return { read, readAll };
}

async function readJobs(client, options, createdAfter) {
  const query = new URLSearchParams({
    select: "id,status,stage,created_at,updated_at",
    created_at: `gte.${createdAfter}`,
    order: "created_at.desc",
  });
  if (options.statuses.length > 0) query.set("status", `in.(${options.statuses.join(",")})`);
  return client.read("document_v2_jobs", query, { from: 0, to: options.limit - 1 });
}

async function readJobChildren(client, table, fields, jobIds) {
  const rows = [];
  for (const batch of chunks(jobIds, JOB_ID_BATCH_SIZE)) {
    const query = new URLSearchParams({
      select: fields,
      job_id: `in.(${batch.join(",")})`,
      order: "created_at.asc",
    });
    rows.push(...(await client.readAll(table, query)));
  }
  return rows;
}

function printHelp() {
  console.log(`Usage: npm run analyze:document-v2-failures -- [options]\n\nOptions:\n  --since=30d                  ISO timestamp or day duration\n  --limit=250                  Maximum jobs (1-5000)\n  --statuses=failed,paused     Optional status filter; default is all\n  --output=path/report.json    JSON report path\n  --csv=path/jobs.csv          Per-job CSV path\n\nThis command is read-only. It never reads job_payload, raw responses, or parsed document content.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const createdAfter = sinceIso(options.since);
  const client = restClient(requiredEnvironment());
  const jobs = await readJobs(client, options, createdAfter);
  const jobIds = jobs.map((job) => job.id);
  const [executions, events] = jobIds.length
    ? await Promise.all([
        readJobChildren(
          client,
          "document_v2_model_executions",
          [
            "execution_key", "job_id", "component_key", "operation", "provider",
            "resolved_model_id", "status", "attempt_number", "parent_execution_key",
            "failure_category", "parse_status", "candidate_diagnostics", "input_tokens",
            "output_tokens", "reasoning_tokens", "calculated_cost_usd", "recovery_mode",
            "created_at", "completed_at",
          ].join(","),
          jobIds,
        ),
        readJobChildren(
          client,
          "document_v2_job_events",
          "job_id,sequence,stage,status,event_payload,created_at",
          jobIds,
        ),
      ])
    : [[], []];

  const report = analyzeDocumentV2FailureAttribution({
    jobs,
    executions,
    events,
    query: {
      createdAfter,
      limit: options.limit,
      statuses: options.statuses,
      protectedContentRead: false,
    },
  });
  await Promise.all([
    mkdir(path.dirname(options.output), { recursive: true }),
    mkdir(path.dirname(options.csv), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(options.csv, documentV2FailureAttributionCsv(report), "utf8"),
  ]);

  console.log(`Analyzed ${report.sourceCounts.jobs} jobs and ${report.sourceCounts.modelExecutions} model executions.`);
  console.log(`Component structured failures without internal recovery: ${report.summary.component.structuredFailureWithoutInternalRecoveryCount} across ${report.summary.component.affectedJobCount} jobs.`);
  console.log(`Jobs with component outer retries: ${report.summary.component.outerRetryJobCount}.`);
  console.log(`Planning internal recovery executions: ${report.summary.planning.internalRecoveryExecutionCount}.`);
  console.log(`Figure terminal failure events: ${report.summary.figures.terminalFailureEventCount}.`);
  console.log(`JSON: ${path.resolve(options.output)}`);
  console.log(`CSV:  ${path.resolve(options.csv)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
