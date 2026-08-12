import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantNarrativeFindingProviderResultV1Schema,
  type GrantNarrativeFindingContentV1,
} from "../../diagnostics/semantic-review-v6-contracts.ts";
import {
  assembleGrantNarrativeReviewV1,
  type GrantNarrativeReviewAssemblyIssueV1,
  type GrantNarrativeReviewNormalizationActionV1,
} from "../../diagnostics/semantic-review-v6-narrative-assembler.ts";
import {
  buildGrantNarrativeReviewModelInputV1,
} from "../../diagnostics/semantic-review-v6-narrative-input.ts";
import { buildGrantNarrativeReviewMessagesV1 } from "../../diagnostics/semantic-review-v6-narrative-prompt.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../../diagnostics/semantic-review-v6-input.ts";
import type { GrantDiagnosticImageAdmission } from "../../diagnostics/multimodal-diagnostic-input.ts";
import { attachGrantDiagnosticImages } from "./openai-grant-diagnostic-images.ts";
import { safeGrantDiagnosticValidationIssues, type GrantDiagnosticValidationIssue } from "../../diagnostics/validation-telemetry.ts";

export type GrantNarrativeReviewExecutionFailureCodeV1 =
  | "narrative_review_output_truncated"
  | "narrative_review_structured_output_invalid"
  | "narrative_review_reference_invalid"
  | "narrative_review_image_invalid"
  | "narrative_review_provider_failure";

export type GrantNarrativeReviewExecutionMetadataV1 = {
  operation: "diagnostic.narrative_review";
  contractVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion;
  schemaVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion;
  promptVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion;
  policyVersion: typeof GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion;
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  finishReason?: string;
  refusal?: boolean;
  locationScopeFingerprint: string;
  imageScopeFingerprint: string;
  imageCoverageMode: "text_only" | "multimodal";
  suppliedImageCount: number;
  inputFingerprint: string;
  responseHash?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  validationIssues?: GrantDiagnosticValidationIssue[];
  assemblyIssues?: GrantNarrativeReviewAssemblyIssueV1[];
  normalizationActions?: GrantNarrativeReviewNormalizationActionV1[];
  providerStatus?: number;
  retryableProviderFailure?: boolean;
};

export type GrantNarrativeReviewExecutionResultV1 = {
  narrativeFindings: GrantNarrativeFindingContentV1[];
  usage: Pick<GrantNarrativeReviewExecutionMetadataV1, "inputTokens" | "outputTokens" | "reasoningTokens">;
  execution: GrantNarrativeReviewExecutionMetadataV1;
};

export class GrantNarrativeReviewExecutionErrorV1 extends Error {
  readonly code: GrantNarrativeReviewExecutionFailureCodeV1;
  readonly metadata: GrantNarrativeReviewExecutionMetadataV1;

  constructor(code: GrantNarrativeReviewExecutionFailureCodeV1, message: string, metadata: GrantNarrativeReviewExecutionMetadataV1) {
    super(message);
    this.name = "GrantNarrativeReviewExecutionErrorV1";
    this.code = code;
    this.metadata = metadata;
  }
}

export function grantNarrativeReviewResponseFormatV1() {
  return zodResponseFormat(GrantNarrativeFindingProviderResultV1Schema, "grant_narrative_review_v1");
}

function hash(content?: string | null): string | undefined {
  return content ? createHash("sha256").update(content).digest("hex") : undefined;
}

function assemblyFailureCode(issues: GrantNarrativeReviewAssemblyIssueV1[]): GrantNarrativeReviewExecutionFailureCodeV1 {
  if (issues.some((issue) => issue.code === "image_reference_invalid" || issue.code === "image_scope_invalid")) {
    return "narrative_review_image_invalid";
  }
  if (issues.some((issue) => issue.code === "primary_location_invalid")) return "narrative_review_reference_invalid";
  return "narrative_review_structured_output_invalid";
}

/** One paid Narrative Review attempt. Current image authorization is supplied
 * by Grant Model Data Gateway; aggregate V6 execution owns retry and budget. */
export async function executeGrantNarrativeReviewV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  imageAdmission: GrantDiagnosticImageAdmission;
  maxCompletionTokens: number;
}): Promise<GrantNarrativeReviewExecutionResultV1> {
  if (!Number.isInteger(input.maxCompletionTokens) || input.maxCompletionTokens < 1000 || input.maxCompletionTokens > 24000) {
    throw new RangeError("Narrative Review completion budget must be an integer between 1000 and 24000.");
  }
  const narrative = buildGrantNarrativeReviewModelInputV1({ prepared: input.prepared, imageAdmission: input.imageAdmission });
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  const metadata = (): GrantNarrativeReviewExecutionMetadataV1 => ({
    operation: "diagnostic.narrative_review",
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion,
    promptVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion,
    policyVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion,
    provider: "openai",
    modelId: input.modelId,
    providerRequestId: response?.id,
    finishReason: response?.choices[0]?.finish_reason,
    refusal: Boolean(response?.choices[0]?.message.refusal),
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    imageScopeFingerprint: input.imageAdmission.coverage.imageScopeFingerprint,
    imageCoverageMode: input.imageAdmission.coverage.mode,
    suppliedImageCount: input.imageAdmission.coverage.suppliedCount,
    inputFingerprint: input.prepared.inputFingerprint,
    responseHash: hash(response?.choices[0]?.message.content),
    inputTokens: response?.usage?.prompt_tokens ?? 0,
    outputTokens: response?.usage?.completion_tokens ?? 0,
    reasoningTokens: response?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  });

  try {
    response = await input.client.chat.completions.create({
      model: input.modelId,
      response_format: grantNarrativeReviewResponseFormatV1(),
      reasoning_effort: "medium",
      max_completion_tokens: input.maxCompletionTokens,
      messages: attachGrantDiagnosticImages(buildGrantNarrativeReviewMessagesV1(narrative.request), input.imageAdmission),
    });
    const choice = response.choices[0];
    const currentMetadata = metadata();
    if (choice?.finish_reason === "length") {
      throw new GrantNarrativeReviewExecutionErrorV1("narrative_review_output_truncated", "Narrative Review output reached its token limit.", currentMetadata);
    }
    if (choice?.finish_reason === "content_filter" || choice?.message.refusal) {
      throw new GrantNarrativeReviewExecutionErrorV1("narrative_review_provider_failure", "Narrative Review was not completed by the provider.", currentMetadata);
    }
    const content = choice?.message.content;
    if (!content) {
      throw new GrantNarrativeReviewExecutionErrorV1("narrative_review_structured_output_invalid", "Narrative Review returned no structured content.", currentMetadata);
    }
    try {
      const providerResult = GrantNarrativeFindingProviderResultV1Schema.parse(JSON.parse(content));
      const assembled = assembleGrantNarrativeReviewV1({ prepared: input.prepared, narrative, providerResult });
      if (!assembled.success) {
        throw new GrantNarrativeReviewExecutionErrorV1(
          assemblyFailureCode(assembled.issues),
          "Narrative Review failed deterministic reference or image checks.",
          { ...currentMetadata, assemblyIssues: assembled.issues, normalizationActions: assembled.actions },
        );
      }
      return {
        narrativeFindings: assembled.narrativeFindings,
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
      if (error instanceof GrantNarrativeReviewExecutionErrorV1) throw error;
      const validationIssues = error instanceof z.ZodError
        ? safeGrantDiagnosticValidationIssues(error)
        : [{ path: "$", code: "syntax_error", rule: "json_parse_error", fieldClass: "unknown" as const }];
      throw new GrantNarrativeReviewExecutionErrorV1(
        "narrative_review_structured_output_invalid",
        "Narrative Review output did not satisfy the strict contract.",
        { ...currentMetadata, validationIssues },
      );
    }
  } catch (error) {
    if (error instanceof GrantNarrativeReviewExecutionErrorV1) throw error;
    const providerStatus = error instanceof OpenAI.APIError ? error.status : undefined;
    const retryableProviderFailure = error instanceof OpenAI.RateLimitError
      || (error instanceof OpenAI.APIError && error.status >= 500);
    throw new GrantNarrativeReviewExecutionErrorV1(
      "narrative_review_provider_failure",
      error instanceof Error ? error.message : "Narrative Review provider request failed.",
      { ...metadata(), providerStatus, retryableProviderFailure },
    );
  }
}
