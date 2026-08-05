import type { ResearchExplorationProductionConfig } from "./runtime-config";
import { RESEARCH_EXPLORATION_RUNTIME_APPROVAL_ENVIRONMENT_VARIABLE } from "../research-exploration/runtime-policy";

let cachedToken: { value: string; expiresAtMs: number } | undefined;

export function createStormWorkloadIdentityAudience(
  config: ResearchExplorationProductionConfig,
): string {
  return `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.workloadIdentityPoolId}/providers/${config.workloadIdentityProviderId}`;
}

async function getAccessToken(input: {
  config: ResearchExplorationProductionConfig;
  vercelOidcToken: string;
}): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const stsResponse = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: createStormWorkloadIdentityAudience(input.config),
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: input.vercelOidcToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!stsResponse.ok) {
    throw new Error(`Google STS token exchange failed (${stsResponse.status}).`);
  }
  const stsPayload = (await stsResponse.json()) as {
    access_token?: string;
  };
  if (!stsPayload.access_token) {
    throw new Error("Google STS response has no access token.");
  }
  const impersonationResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(input.config.serviceAccountEmail)}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stsPayload.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: ["https://www.googleapis.com/auth/cloud-platform"],
        lifetime: "3600s",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!impersonationResponse.ok) {
    throw new Error(
      `Google service account impersonation failed (${impersonationResponse.status}).`,
    );
  }
  const impersonationPayload = (await impersonationResponse.json()) as {
    accessToken?: string;
    expireTime?: string;
  };
  if (!impersonationPayload.accessToken) {
    throw new Error("Google impersonation response has no access token.");
  }
  cachedToken = {
    value: impersonationPayload.accessToken,
    expiresAtMs:
      Date.parse(impersonationPayload.expireTime ?? "") ||
      Date.now() + 3_600 * 1_000,
  };
  return cachedToken.value;
}

export function createStormCloudRunRunRequest(executionId: string) {
  return {
    overrides: {
      taskCount: 1,
      containerOverrides: [
        {
          env: [
            { name: "STORM_EXECUTION_ID", value: executionId },
            {
              name: RESEARCH_EXPLORATION_RUNTIME_APPROVAL_ENVIRONMENT_VARIABLE,
              value: "true",
            },
            { name: "STORM_MAX_MODEL_CALLS", value: "30" },
          ],
        },
      ],
    },
  };
}

export async function dispatchStormCloudRunJob(input: {
  config: ResearchExplorationProductionConfig;
  executionId: string;
  vercelOidcToken: string;
}): Promise<{ operationName: string }> {
  const token = await getAccessToken({
    config: input.config,
    vercelOidcToken: input.vercelOidcToken,
  });
  const jobPath = [
    "projects",
    encodeURIComponent(input.config.projectId),
    "locations",
    encodeURIComponent(input.config.region),
    "jobs",
    encodeURIComponent(input.config.jobName),
  ].join("/");
  const response = await fetch(`https://run.googleapis.com/v2/${jobPath}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createStormCloudRunRunRequest(input.executionId)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Cloud Run job dispatch failed (${response.status}).`);
  }
  const payload = (await response.json()) as { name?: string };
  if (!payload.name) throw new Error("Cloud Run did not return an operation name.");
  return { operationName: payload.name };
}
