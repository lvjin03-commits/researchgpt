import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantFactMapProviderResultV1Schema,
  type GrantFactMapV1,
} from "../../diagnostics/semantic-review-v6-contracts.ts";
import { assembleGrantFactMapV1, buildGrantFactMapSystemPromptV1, type GrantFactMapIssueV1 } from "../../diagnostics/semantic-review-v6-fact-map.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../../diagnostics/semantic-review-v6-input.ts";
import { safeGrantDiagnosticValidationIssues, type GrantDiagnosticValidationIssue } from "../../diagnostics/validation-telemetry.ts";

export type GrantFactMapExecutionFailureCodeV1 =
  | "fact_map_output_truncated"
  | "fact_map_structured_output_invalid"
  | "fact_map_reference_invalid"
  | "fact_map_provider_failure";

export type GrantFactMapExecutionMetadataV1 = {
  operation: "diagnostic.fact_mapping";
  contractVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion;
  schemaVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion;
  promptVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion;
  policyVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion;
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  finishReason?: string;
  refusal?: boolean;
  locationScopeFingerprint: string;
  inputFingerprint: string;
  responseHash?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  validationIssues?: GrantDiagnosticValidationIssue[];
  assemblyIssues?: GrantFactMapIssueV1[];
  providerStatus?: number;
  retryableProviderFailure?: boolean;
};

export class GrantFactMapExecutionErrorV1 extends Error {
  readonly code: GrantFactMapExecutionFailureCodeV1;
  readonly metadata: GrantFactMapExecutionMetadataV1;
  constructor(code: GrantFactMapExecutionFailureCodeV1, message: string, metadata: GrantFactMapExecutionMetadataV1) {
    super(message);
    this.name = "GrantFactMapExecutionErrorV1";
    this.code = code;
    this.metadata = metadata;
  }
}

export function grantFactMapResponseFormatV1() {
  return zodResponseFormat(GrantFactMapProviderResultV1Schema, "grant_fact_map_v1");
}

function hash(content?: string | null): string | undefined {
  return content ? createHash("sha256").update(content).digest("hex") : undefined;
}

export async function executeGrantFactMapV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  maxCompletionTokens: number;
}): Promise<{ factMap: GrantFactMapV1; usage: { inputTokens: number; outputTokens: number; reasoningTokens: number }; execution: GrantFactMapExecutionMetadataV1 }> {
  if (!Number.isInteger(input.maxCompletionTokens) || input.maxCompletionTokens < 1000 || input.maxCompletionTokens > 12000) {
    throw new RangeError("Fact Map completion budget must be an integer between 1000 and 12000.");
  }
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  const metadata = (): GrantFactMapExecutionMetadataV1 => ({
    operation: "diagnostic.fact_mapping",
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion,
    promptVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion,
    policyVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion,
    provider: "openai",
    modelId: input.modelId,
    providerRequestId: response?.id,
    finishReason: response?.choices[0]?.finish_reason,
    refusal: Boolean(response?.choices[0]?.message.refusal),
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    inputFingerprint: input.prepared.inputFingerprint,
    responseHash: hash(response?.choices[0]?.message.content),
    inputTokens: response?.usage?.prompt_tokens ?? 0,
    outputTokens: response?.usage?.completion_tokens ?? 0,
    reasoningTokens: response?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  });
  try {
    response = await input.client.chat.completions.create({
      model: input.modelId,
      response_format: grantFactMapResponseFormatV1(),
      reasoning_effort: "medium",
      max_completion_tokens: input.maxCompletionTokens,
      messages: [
        { role: "system", content: buildGrantFactMapSystemPromptV1(input.prepared.factMapRequest.documentLanguage) },
        { role: "user", content: JSON.stringify(input.prepared.factMapRequest) },
      ],
    });
    const choice = response.choices[0];
    const current = metadata();
    if (choice?.finish_reason === "length") throw new GrantFactMapExecutionErrorV1("fact_map_output_truncated", "Fact Map output reached its token limit.", current);
    if (choice?.finish_reason === "content_filter" || choice?.message.refusal) throw new GrantFactMapExecutionErrorV1("fact_map_provider_failure", "Fact Map was not completed by the provider.", current);
    if (!choice?.message.content) throw new GrantFactMapExecutionErrorV1("fact_map_structured_output_invalid", "Fact Map returned no structured content.", current);
    try {
      const providerResult = GrantFactMapProviderResultV1Schema.parse(JSON.parse(choice.message.content));
      const assembled = assembleGrantFactMapV1({ prepared: input.prepared, providerResult });
      if (!assembled.success) {
        const referenceInvalid = assembled.issues.some((issue) => ["source_location_missing", "source_location_duplicate", "source_location_unknown", "source_location_empty"].includes(issue.code));
        throw new GrantFactMapExecutionErrorV1(
          referenceInvalid ? "fact_map_reference_invalid" : "fact_map_structured_output_invalid",
          "Fact Map failed deterministic structure or reference checks.",
          { ...current, assemblyIssues: assembled.issues },
        );
      }
      return {
        factMap: assembled.factMap,
        usage: { inputTokens: current.inputTokens, outputTokens: current.outputTokens, reasoningTokens: current.reasoningTokens },
        execution: current,
      };
    } catch (error) {
      if (error instanceof GrantFactMapExecutionErrorV1) throw error;
      const validationIssues = error instanceof z.ZodError
        ? safeGrantDiagnosticValidationIssues(error)
        : [{ path: "$", code: "syntax_error", rule: "json_parse_error", fieldClass: "unknown" as const }];
      throw new GrantFactMapExecutionErrorV1("fact_map_structured_output_invalid", "Fact Map output did not satisfy the strict contract.", { ...current, validationIssues });
    }
  } catch (error) {
    if (error instanceof GrantFactMapExecutionErrorV1) throw error;
    const providerStatus = error instanceof OpenAI.APIError ? error.status : undefined;
    const retryableProviderFailure = error instanceof OpenAI.RateLimitError || (error instanceof OpenAI.APIError && error.status >= 500);
    throw new GrantFactMapExecutionErrorV1("fact_map_provider_failure", error instanceof Error ? error.message : "Fact Map provider request failed.", { ...metadata(), providerStatus, retryableProviderFailure });
  }
}
