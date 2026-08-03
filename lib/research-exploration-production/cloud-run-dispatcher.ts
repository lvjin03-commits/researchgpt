import { createSign } from "node:crypto";
import type { ResearchExplorationProductionConfig } from "./runtime-config";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { value: string; expiresAtMs: number } | undefined;

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function parseServiceAccount(raw: string): GoogleServiceAccount {
  const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Google Cloud service account JSON is incomplete.");
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replaceAll("\\n", "\n"),
    token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
  };
}

async function getAccessToken(rawServiceAccount: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const account = parseServiceAccount(rawServiceAccount);
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: account.token_uri,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, "base64url")}`;
  const response = await fetch(account.token_uri!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new Error("Google OAuth response has no access token.");
  cachedToken = {
    value: payload.access_token,
    expiresAtMs: Date.now() + (payload.expires_in ?? 3_600) * 1_000,
  };
  return cachedToken.value;
}

export async function dispatchStormCloudRunJob(input: {
  config: ResearchExplorationProductionConfig;
  executionId: string;
}): Promise<{ operationName: string }> {
  const token = await getAccessToken(input.config.serviceAccountJson);
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
    body: JSON.stringify({
      overrides: {
        taskCount: 1,
        containerOverrides: [
          {
            env: [
              { name: "STORM_EXECUTION_ID", value: input.executionId },
            ],
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Cloud Run job dispatch failed (${response.status}).`);
  }
  const payload = (await response.json()) as { name?: string };
  if (!payload.name) throw new Error("Cloud Run did not return an operation name.");
  return { operationName: payload.name };
}
