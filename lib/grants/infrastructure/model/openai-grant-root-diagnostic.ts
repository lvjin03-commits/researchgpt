import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantRootDiagnosticProviderResultV1Schema,
  type GrantArgumentMapV1,
  type GrantRootDiagnosticResultV1,
} from "../../diagnostics/hierarchical-semantic-contracts.ts";
import {
  buildGrantRootDiagnosticModelInputV1,
  type GrantHierarchicalDiagnosticPreparedInputV1,
} from "../../diagnostics/hierarchical-semantic-input.ts";
import { buildGrantRootDiagnosticMessagesV1 } from "../../diagnostics/hierarchical-root-diagnostic-prompt.ts";
import {
  assembleGrantRootDiagnosticResultV1,
  type GrantRootDiagnosticNormalizationActionV1,
} from "../../diagnostics/hierarchical-root-diagnostic-assembler.ts";
import {
  safeGrantDiagnosticValidationIssues,
  type GrantDiagnosticValidationIssue,
} from "../../diagnostics/validation-telemetry.ts";

export type GrantRootDiagnosticExecutionFailureCode =
  | "root_diagnosis_output_truncated"
  | "root_diagnosis_structured_output_invalid"
  | "root_diagnosis_reference_invalid"
  | "root_diagnosis_evidence_invalid"
  | "root_diagnosis_provider_failure";

export type GrantRootDiagnosticExecutionMetadataV1 = {
  operation: "diagnostic.root_diagnosis";
  policyVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion;
  schemaVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerSchemaVersion;
  promptVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.promptVersion;
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  finishReason?: string;
  refusal?: boolean;
  attemptCount: number;
  attemptPurpose: "initial" | "capacity_retry" | "schema_repair" | "transient_retry";
  recoveredFrom?: GrantRootDiagnosticExecutionFailureCode;
  locationScopeFingerprint: string;
  responseHash?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  validationIssues?: GrantDiagnosticValidationIssue[];
  invalidReferencePaths?: string[];
  invalidEvidencePaths?: string[];
  normalizationActions?: GrantRootDiagnosticNormalizationActionV1[];
  providerStatus?: number;
  retryableProviderFailure?: boolean;
};

export type GrantRootDiagnosticExecutionResultV1 = {
  result: GrantRootDiagnosticResultV1;
  usage: Pick<GrantRootDiagnosticExecutionMetadataV1, "inputTokens" | "outputTokens" | "reasoningTokens">;
  execution: GrantRootDiagnosticExecutionMetadataV1;
};

export class GrantRootDiagnosticExecutionError extends Error {
  readonly code: GrantRootDiagnosticExecutionFailureCode;
  readonly metadata: GrantRootDiagnosticExecutionMetadataV1;

  constructor(code: GrantRootDiagnosticExecutionFailureCode, message: string, metadata: GrantRootDiagnosticExecutionMetadataV1) {
    super(message);
    this.name = "GrantRootDiagnosticExecutionError";
    this.code = code;
    this.metadata = metadata;
  }
}

export function grantRootDiagnosticResponseFormatV1() {
  return zodResponseFormat(GrantRootDiagnosticProviderResultV1Schema, "grant_root_diagnostic_v1");
}

function responseHash(content?: string | null): string | undefined {
  return content ? createHash("sha256").update(content).digest("hex") : undefined;
}

export async function executeGrantRootDiagnosticV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
  argumentMap: GrantArgumentMapV1;
  attempt?: {
    number: number;
    purpose: GrantRootDiagnosticExecutionMetadataV1["attemptPurpose"];
    recoveredFrom?: GrantRootDiagnosticExecutionFailureCode;
    repairInstruction?: string;
    maxCompletionTokens?: number;
  };
}): Promise<GrantRootDiagnosticExecutionResultV1> {
  const attempt = input.attempt ?? { number: 1, purpose: "initial" as const };
  const request = buildGrantRootDiagnosticModelInputV1({ prepared: input.prepared, argumentMap: input.argumentMap });
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  const metadata = (): GrantRootDiagnosticExecutionMetadataV1 => ({
    operation: "diagnostic.root_diagnosis",
    policyVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion,
    schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerSchemaVersion,
    promptVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.promptVersion,
    provider: "openai",
    modelId: input.modelId,
    providerRequestId: response?.id,
    finishReason: response?.choices[0]?.finish_reason,
    refusal: Boolean(response?.choices[0]?.message.refusal),
    attemptCount: attempt.number,
    attemptPurpose: attempt.purpose,
    recoveredFrom: attempt.recoveredFrom,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    responseHash: responseHash(response?.choices[0]?.message.content),
    inputTokens: response?.usage?.prompt_tokens ?? 0,
    outputTokens: response?.usage?.completion_tokens ?? 0,
    reasoningTokens: response?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  });

  try {
    response = await input.client.chat.completions.create({
      model: input.modelId,
      response_format: grantRootDiagnosticResponseFormatV1(),
      reasoning_effort: "medium",
      max_completion_tokens: attempt.maxCompletionTokens ?? 9000,
      messages: buildGrantRootDiagnosticMessagesV1(request, attempt.repairInstruction),
    });
    const choice = response.choices[0];
    const currentMetadata = metadata();
    if (choice?.finish_reason === "length") {
      throw new GrantRootDiagnosticExecutionError("root_diagnosis_output_truncated", "Root diagnostic output reached its token limit.", currentMetadata);
    }
    if (choice?.finish_reason === "content_filter" || choice?.message.refusal) {
      throw new GrantRootDiagnosticExecutionError("root_diagnosis_provider_failure", "Root diagnostic request was not completed by the provider.", currentMetadata);
    }
    const content = choice?.message.content;
    if (!content) {
      throw new GrantRootDiagnosticExecutionError("root_diagnosis_structured_output_invalid", "Root diagnostic returned no structured content.", currentMetadata);
    }
    try {
      const providerResult = GrantRootDiagnosticProviderResultV1Schema.parse(JSON.parse(content));
      const assembled = assembleGrantRootDiagnosticResultV1({
        providerResult,
        locationByRef: input.prepared.locationByRef,
        allowedEvidenceCardIds: input.prepared.allowedEvidenceCardIds,
      });
      const enrichedMetadata = assembled.actions.length > 0
        ? { ...currentMetadata, normalizationActions: assembled.actions }
        : currentMetadata;
      if (providerResult.rootFindings.length > 0 && assembled.result.rootFindings.length === 0) {
        if (assembled.invalidEvidencePaths.length > 0 && assembled.invalidLocationPaths.length === 0) {
          throw new GrantRootDiagnosticExecutionError(
            "root_diagnosis_evidence_invalid",
            "Root diagnostic returned no usable finding after evidence authorization checks.",
            { ...enrichedMetadata, invalidEvidencePaths: assembled.invalidEvidencePaths },
          );
        }
        throw new GrantRootDiagnosticExecutionError(
          "root_diagnosis_reference_invalid",
          "Root diagnostic returned no usable finding after location reference checks.",
          { ...enrichedMetadata, invalidReferencePaths: assembled.invalidLocationPaths, invalidEvidencePaths: assembled.invalidEvidencePaths },
        );
      }
      return {
        result: assembled.result,
        usage: {
          inputTokens: currentMetadata.inputTokens,
          outputTokens: currentMetadata.outputTokens,
          reasoningTokens: currentMetadata.reasoningTokens,
        },
        execution: enrichedMetadata,
      };
    } catch (error) {
      if (error instanceof GrantRootDiagnosticExecutionError) throw error;
      const validationIssues = error instanceof z.ZodError
        ? safeGrantDiagnosticValidationIssues(error)
        : [{ path: "$", code: "syntax_error", rule: "json_parse_error", fieldClass: "unknown" as const }];
      throw new GrantRootDiagnosticExecutionError(
        "root_diagnosis_structured_output_invalid",
        "Root diagnostic output did not satisfy the root-finding contract.",
        { ...currentMetadata, validationIssues },
      );
    }
  } catch (error) {
    if (error instanceof GrantRootDiagnosticExecutionError) throw error;
    const providerStatus = error instanceof OpenAI.APIError ? error.status : undefined;
    const retryableProviderFailure = error instanceof OpenAI.RateLimitError
      || (error instanceof OpenAI.APIError && error.status >= 500);
    throw new GrantRootDiagnosticExecutionError(
      "root_diagnosis_provider_failure",
      error instanceof Error ? error.message : "Root diagnostic provider request failed.",
      { ...metadata(), providerStatus, retryableProviderFailure },
    );
  }
}
