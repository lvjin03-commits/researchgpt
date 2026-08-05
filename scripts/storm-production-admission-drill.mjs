import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const reportPath = process.env.STORM_ADMISSION_REPORT || ".storm-admission-output/report.json";
const command = process.argv[2];

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${endpoint}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} failed (${response.status}): ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(name, payload) {
  return request(`/rpc/${name}`, { method: "POST", body: JSON.stringify(payload) });
}

async function ownerId() {
  const rows = await request("/document_v2_jobs?select=owner_id&order=created_at.desc&limit=1");
  if (!rows?.[0]?.owner_id) throw new Error("No production owner is available for the isolated admission drill.");
  return rows[0].owner_id;
}

function canaryRequest(explorationId) {
  return {
    schemaVersion: "storm-exploration-request-v1",
    explorationId,
    topic: "Reversible physical gel preparation mechanisms",
    purpose: "literature_review",
    language: "en",
    scope: { disciplines: [], excludedTopics: [] },
    sourcePolicy: { useWeb: true, useUserDocuments: false, userResourceIds: [] },
    limits: {
      maxPerspectives: 1,
      maxQuestionsPerPerspective: 1,
      maxSearchQueries: 2,
      maxSources: 3,
      maximumWallTimeMs: 180000,
      maximumModelCalls: 8,
      maximumInspectionCount: 3,
    },
    modelProfile: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "none" },
  };
}

async function insertExecution({ suffix, purpose }) {
  const executionId = randomUUID();
  const explorationId = `storm-${purpose}-${suffix}-${executionId}`.slice(0, 160);
  const inputPayload = canaryRequest(explorationId);
  const fingerprint = createHash("sha256").update(JSON.stringify(inputPayload)).digest("hex");
  const now = new Date();
  const rows = await request("/research_exploration_executions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      execution_id: executionId,
      owner_id: await ownerId(),
      exploration_id: explorationId,
      exploration_revision: 1,
      execution_revision: 0,
      document_job_id: null,
      requirement: "optional",
      adapter: "storm",
      versions: { contract: "storm-exploration-request-v1", drill: purpose },
      input_fingerprint: fingerprint,
      input_payload: inputPayload,
      status: "queued",
      maximum_inspection_count: 3,
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    }),
  });
  if (rows?.[0]?.execution_id !== executionId) throw new Error("Admission execution insert was not confirmed.");
  return rows[0];
}

async function writeReport(report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function leaseRecovery() {
  const inserted = await insertExecution({ suffix: "lease", purpose: "lease-recovery" });
  const firstOwner = `admission-first-${randomUUID()}`;
  const secondOwner = `admission-recovery-${randomUUID()}`;
  const first = await rpc("claim_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: firstOwner,
    p_lease_seconds: 30,
  });
  if (first?.length !== 1 || first[0].lease_token !== 1 || first[0].status !== "running") {
    throw new Error("Initial production lease claim failed its contract.");
  }

  const forcedExpiry = new Date(Date.now() - 61_000).toISOString();
  const expired = await request(
    `/research_exploration_executions?execution_id=eq.${inserted.execution_id}&lease_owner=eq.${encodeURIComponent(firstOwner)}&lease_token=eq.1`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ lease_expires_at: forcedExpiry, heartbeat_at: forcedExpiry }),
    },
  );
  if (expired?.length !== 1) throw new Error("The drill could not simulate an expired owned lease.");

  const recovered = await rpc("claim_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: secondOwner,
    p_lease_seconds: 30,
  });
  if (recovered?.length !== 1 || recovered[0].lease_token !== 2 || recovered[0].recovery_count !== 1) {
    throw new Error("Expired lease was not recovered with a new fencing token.");
  }

  const staleHeartbeat = await rpc("heartbeat_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: firstOwner,
    p_lease_token: 1,
    p_lease_seconds: 30,
  });
  const staleCompletion = await rpc("complete_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: firstOwner,
    p_lease_token: 1,
    p_status: "partial",
    p_result: { drill: "stale-writer-must-not-publish" },
  });
  const liveHeartbeat = await rpc("heartbeat_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: secondOwner,
    p_lease_token: 2,
    p_lease_seconds: 30,
  });
  if (staleHeartbeat !== false || staleCompletion !== false || liveHeartbeat !== true) {
    throw new Error("Production fencing rejected the admission contract.");
  }

  const finalized = await rpc("fail_research_exploration_execution", {
    p_execution_id: inserted.execution_id,
    p_lease_owner: secondOwner,
    p_lease_token: 2,
    p_failure: {
      code: "admission_lease_recovery_verified",
      category: "infrastructure",
      retryability: "none",
      technicalMessage: "Synthetic production admission record; no provider was called.",
      userMessageCode: "admission_test_only",
    },
  });
  if (finalized !== true) throw new Error("Recovered owner could not finalize the drill record.");

  const report = {
    schemaVersion: "storm-production-admission-report-v1",
    generatedAt: new Date().toISOString(),
    operation: "lease_recovery",
    executionId: inserted.execution_id,
    passed: true,
    checks: {
      initialClaimToken: first[0].lease_token,
      recoveredClaimToken: recovered[0].lease_token,
      recoveryCount: recovered[0].recovery_count,
      staleHeartbeatRejected: !staleHeartbeat,
      staleCompletionRejected: !staleCompletion,
      recoveredHeartbeatAccepted: liveHeartbeat,
      providerCalls: 0,
    },
  };
  await writeReport(report);
  console.log(JSON.stringify(report));
}

async function prepareProposal() {
  const inserted = await insertExecution({ suffix: "proposal", purpose: "proposal-canary" });
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `execution_id=${inserted.execution_id}\n`, { flag: "a" });
  }
  await writeReport({
    schemaVersion: "storm-production-admission-report-v1",
    generatedAt: new Date().toISOString(),
    operation: "proposal_prepare",
    executionId: inserted.execution_id,
    nonAuthoritative: true,
    documentJobId: null,
  });
  console.log(inserted.execution_id);
}

async function verifyProposal() {
  const executionId = required("STORM_EXECUTION_ID");
  const rows = await request(`/research_exploration_executions?execution_id=eq.${executionId}&select=*`);
  const row = rows?.[0];
  if (!row || !["complete", "partial"].includes(row.status) || !row.result_payload) {
    throw new Error(`Proposal canary did not publish a durable result: ${JSON.stringify(row?.failure || row?.status)}`);
  }
  if (row.document_job_id !== null || row.requirement !== "optional") {
    throw new Error("Proposal canary crossed the non-authoritative isolation boundary.");
  }
  const usage = row.result_payload.usage || {};
  if ((usage.modelCalls || 0) > 8 || (usage.searchCalls || 0) > 2) {
    throw new Error("Proposal canary exceeded its frozen provider budget.");
  }
  const providerCalls = usage.providerCalls || [];
  if (!providerCalls.length || providerCalls.some((call) => call.status !== "succeeded" || !call.providerRequestId)) {
    throw new Error("Proposal canary provider evidence is incomplete.");
  }
  const report = {
    schemaVersion: "storm-production-admission-report-v1",
    generatedAt: new Date().toISOString(),
    operation: "proposal_canary",
    executionId,
    passed: true,
    nonAuthoritative: true,
    status: row.status,
    resultLocation: row.result_location,
    counts: {
      perspectives: row.result_payload.perspectives?.length || 0,
      questions: row.result_payload.questions?.length || 0,
      sources: row.result_payload.sources?.length || 0,
      outlines: row.result_payload.outlines?.length || 0,
    },
    usage,
  };
  await writeReport(report);
  console.log(JSON.stringify(report));
}

if (command === "lease-recovery") await leaseRecovery();
else if (command === "prepare-proposal") await prepareProposal();
else if (command === "verify-proposal") await verifyProposal();
else throw new Error("Expected lease-recovery, prepare-proposal, or verify-proposal.");
