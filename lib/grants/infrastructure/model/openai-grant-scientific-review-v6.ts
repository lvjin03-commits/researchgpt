import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantScientificReviewProviderResultV1Schema,
  type GrantFactMapCoverageReportV1,
  type GrantFactMapV1,
  type GrantScientificFindingContentV1,
} from "../../diagnostics/semantic-review-v6-contracts.ts";
import {
  assembleGrantScientificReviewV1,
  type GrantScientificReviewAssemblyIssueV1,
  type GrantScientificReviewNormalizationActionV1,
} from "../../diagnostics/semantic-review-v6-scientific-assembler.ts";
import {
  buildGrantScientificReviewModelInputV1,
} from "../../diagnostics/semantic-review-v6-scientific-input.ts";
import {
  buildGrantScientificReviewMessagesV1,
} from "../../diagnostics/semantic-review-v6-scientific-prompt.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../../diagnostics/semantic-review-v6-input.ts";
import {
  safeGrantDiagnosticValidationIssues,
  type GrantDiagnosticValidationIssue,
} from "../../diagnostics/validation-telemetry.ts";

export type GrantScientificReviewExecutionFailureCodeV1 =
  | "scientific_review_output_truncated"
  | "scientific_review_structured_output_invalid"
  | "scientific_review_reference_invalid"
  | "scientific_review_evidence_invalid"
  | "scientific_review_coverage_invalid"
  | "scientific_review_provider_failure";

export type GrantScientificReviewExecutionMetadataV1 = {
  operation: "diagnostic.scientific_review";
  contractVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion;
  schemaVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion;
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
  assemblyIssues?: GrantScientificReviewAssemblyIssueV1[];
  normalizationActions?: GrantScientificReviewNormalizationActionV1[];
  providerStatus?: number;
  retryableProviderFailure?: boolean;
};

export type GrantScientificReviewExecutionResultV1 = {
  scientificFindings: GrantScientificFindingContentV1[];
  coverageReport: GrantFactMapCoverageReportV1;
  usage: Pick<GrantScientificReviewExecutionMetadataV1, "inputTokens" | "outputTokens" | "reasoningTokens">;
  execution: GrantScientificReviewExecutionMetadataV1;
};

export class GrantScientificReviewExecutionErrorV1 extends Error {
  readonly code: GrantScientificReviewExecutionFailureCodeV1;
  readonly metadata: GrantScientificReviewExecutionMetadataV1;

  constructor(
    code: GrantScientificReviewExecutionFailureCodeV1,
    message: string,
    metadata: GrantScientificReviewExecutionMetadataV1,
  ) {
    super(message);
    this.name = "GrantScientificReviewExecutionErrorV1";
    this.code = code;
    this.metadata = metadata;
  }
}

export function grantScientificReviewResponseFormatV1() {
  return zodResponseFormat(GrantScientificReviewProviderResultV1Schema, "grant_scientific_review_v1");
}

function hash(content?: string | null): string | undefined {
  return content ? createHash("sha256").update(content).digest("hex") : undefined;
}

function assemblyFailureCode(issues: GrantScientificReviewAssemblyIssueV1[]): GrantScientificReviewExecutionFailureCodeV1 {
  if (issues.some((issue) => issue.code === "evidence_reference_invalid" || issue.code === "evidence_scope_invalid")) {
    return "scientific_review_evidence_invalid";
  }
  if (issues.some((issue) => issue.code === "coverage_invalid")) return "scientific_review_coverage_invalid";
  if (issues.some((issue) => [
    "semantic_object_ref_invalid",
    "primary_location_invalid",
    "existing_design_location_invalid",
  ].includes(issue.code))) return "scientific_review_reference_invalid";
  return "scientific_review_structured_output_invalid";
}

/** One paid scientific-review attempt. It intentionally has no retry loop or
 * default token budget; the later aggregate V6 orchestrator must own both. */
export async function executeGrantScientificReviewV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  factMap: GrantFactMapV1;
  maxCompletionTokens: number;
}): Promise<GrantScientificReviewExecutionResultV1> {
  if (!Number.isInteger(input.maxCompletionTokens) || input.maxCompletionTokens < 1000 || input.maxCompletionTokens > 24000) {
    throw new RangeError("Scientific Review completion budget must be an integer between 1000 and 24000.");
  }
  const request = buildGrantScientificReviewModelInputV1({ prepared: input.prepared, factMap: input.factMap });
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  const metadata = (): GrantScientificReviewExecutionMetadataV1 => ({
    operation: "diagnostic.scientific_review",
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion,
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
      response_format: grantScientificReviewResponseFormatV1(),
      reasoning_effort: "medium",
      max_completion_tokens: input.maxCompletionTokens,
      messages: buildGrantScientificReviewMessagesV1(request),
    });
    const choice = response.choices[0];
    const currentMetadata = metadata();
    if (choice?.finish_reason === "length") {
      throw new GrantScientificReviewExecutionErrorV1(
        "scientific_review_output_truncated",
        "Scientific Review output reached its token limit.",
        currentMetadata,
      );
    }
    if (choice?.finish_reason === "content_filter" || choice?.message.refusal) {
      throw new GrantScientificReviewExecutionErrorV1(
        "scientific_review_provider_failure",
        "Scientific Review was not completed by the provider.",
        currentMetadata,
      );
    }
    const content = choice?.message.content;
    if (!content) {
      throw new GrantScientificReviewExecutionErrorV1(
        "scientific_review_structured_output_invalid",
        "Scientific Review returned no structured content.",
        currentMetadata,
      );
    }
    try {
      const providerResult = GrantScientificReviewProviderResultV1Schema.parse(JSON.parse(content));
      const assembled = assembleGrantScientificReviewV1({
        prepared: input.prepared,
        factMap: input.factMap,
        providerResult,
      });
      if (!assembled.success) {
        throw new GrantScientificReviewExecutionErrorV1(
          assemblyFailureCode(assembled.issues),
          "Scientific Review failed deterministic reference, evidence or coverage checks.",
          { ...currentMetadata, assemblyIssues: assembled.issues, normalizationActions: assembled.actions },
        );
      }
      return {
        scientificFindings: assembled.scientificFindings,
        coverageReport: assembled.coverageReport,
        usage: {
          inputTokens: currentMetadata.inputTokens,
          outputTokens: currentMetadata.outputTokens,
          reasoningTokens: currentMetadata.reasoningTokens,
        },
        execution: assembled.actions.length > 0
          ? { ...currentMetadata, normalizationActions: assembled.actions }
          : currentMetadata,
      };
    } catch (error) {
      if (error instanceof GrantScientificReviewExecutionErrorV1) throw error;
      const validationIssues = error instanceof z.ZodError
        ? safeGrantDiagnosticValidationIssues(error)
        : [{ path: "$", code: "syntax_error", rule: "json_parse_error", fieldClass: "unknown" as const }];
      throw new GrantScientificReviewExecutionErrorV1(
        "scientific_review_structured_output_invalid",
        "Scientific Review output did not satisfy the strict contract.",
        { ...currentMetadata, validationIssues },
      );
    }
  } catch (error) {
    if (error instanceof GrantScientificReviewExecutionErrorV1) throw error;
    const providerStatus = error instanceof OpenAI.APIError ? error.status : undefined;
    const retryableProviderFailure = error instanceof OpenAI.RateLimitError
      || (error instanceof OpenAI.APIError && error.status >= 500);
    throw new GrantScientificReviewExecutionErrorV1(
      "scientific_review_provider_failure",
      error instanceof Error ? error.message : "Scientific Review provider request failed.",
      { ...metadata(), providerStatus, retryableProviderFailure },
    );
  }
}

