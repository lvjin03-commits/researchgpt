import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentMapProviderResultV1Schema,
  type GrantArgumentMapV1,
} from "../../diagnostics/hierarchical-semantic-contracts.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "../../diagnostics/hierarchical-semantic-input.ts";
import { assembleGrantArgumentMapV1, GrantArgumentMapReferenceError } from "../../diagnostics/hierarchical-semantic-assembler.ts";
import { buildGrantArgumentMapMessagesV1 } from "../../diagnostics/hierarchical-semantic-prompt.ts";
import { safeGrantDiagnosticValidationIssues, type GrantDiagnosticValidationIssue } from "../../diagnostics/validation-telemetry.ts";

export type GrantArgumentMapExecutionFailureCode =
  | "argument_map_output_truncated"
  | "argument_map_structured_output_invalid"
  | "argument_map_reference_invalid"
  | "argument_map_provider_failure";

export type GrantArgumentMapExecutionMetadataV1 = {
  operation: "diagnostic.argument_mapping";
  policyVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion;
  schemaVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion;
  promptVersion: typeof GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.promptVersion;
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  finishReason?: string;
  refusal?: boolean;
  attemptCount: 1;
  locationScopeFingerprint: string;
  responseHash?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  validationIssues?: GrantDiagnosticValidationIssue[];
  invalidReferencePaths?: string[];
};

export type GrantArgumentMapExecutionResultV1 = {
  argumentMap: GrantArgumentMapV1;
  usage: Pick<GrantArgumentMapExecutionMetadataV1, "inputTokens" | "outputTokens" | "reasoningTokens">;
  execution: GrantArgumentMapExecutionMetadataV1;
};

export class GrantArgumentMapExecutionError extends Error {
  readonly code: GrantArgumentMapExecutionFailureCode;
  readonly metadata: GrantArgumentMapExecutionMetadataV1;

  constructor(code: GrantArgumentMapExecutionFailureCode, message: string, metadata: GrantArgumentMapExecutionMetadataV1) {
    super(message);
    this.name = "GrantArgumentMapExecutionError";
    this.code = code;
    this.metadata = metadata;
  }
}

export function grantArgumentMapResponseFormatV1() {
  return zodResponseFormat(GrantArgumentMapProviderResultV1Schema, "grant_argument_map_v1");
}

function responseHash(content?: string | null): string | undefined {
  return content ? createHash("sha256").update(content).digest("hex") : undefined;
}

function providerFailure(error: unknown): boolean {
  return error instanceof OpenAI.APIError || error instanceof OpenAI.APIConnectionError;
}

/**
 * One bounded provider call for descriptive argument reconstruction. Retry and
 * aggregate two-stage budget policy deliberately remain Step 5 responsibilities.
 */
export async function executeGrantArgumentMapV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
}): Promise<GrantArgumentMapExecutionResultV1> {
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  const baseMetadata = (): GrantArgumentMapExecutionMetadataV1 => ({
    operation: "diagnostic.argument_mapping",
    policyVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion,
    schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
    promptVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.promptVersion,
    provider: "openai",
    modelId: input.modelId,
    providerRequestId: response?.id,
    finishReason: response?.choices[0]?.finish_reason,
    refusal: Boolean(response?.choices[0]?.message.refusal),
    attemptCount: 1,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    responseHash: responseHash(response?.choices[0]?.message.content),
    inputTokens: response?.usage?.prompt_tokens ?? 0,
    outputTokens: response?.usage?.completion_tokens ?? 0,
    reasoningTokens: response?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  });

  try {
    response = await input.client.chat.completions.create({
      model: input.modelId,
      response_format: grantArgumentMapResponseFormatV1(),
      reasoning_effort: "medium",
      max_completion_tokens: 6000,
      messages: buildGrantArgumentMapMessagesV1(input.prepared.argumentMapRequest),
    });
    const choice = response.choices[0];
    const metadata = baseMetadata();
    if (choice?.finish_reason === "length") {
      throw new GrantArgumentMapExecutionError("argument_map_output_truncated", "ArgumentMap output reached its token limit.", metadata);
    }
    if (choice?.finish_reason === "content_filter" || choice?.message.refusal) {
      throw new GrantArgumentMapExecutionError("argument_map_provider_failure", "ArgumentMap request was not completed by the provider.", metadata);
    }
    const content = choice?.message.content;
    if (!content) {
      throw new GrantArgumentMapExecutionError("argument_map_structured_output_invalid", "ArgumentMap returned no structured content.", metadata);
    }
    try {
      const providerResult = GrantArgumentMapProviderResultV1Schema.parse(JSON.parse(content));
      const argumentMap = assembleGrantArgumentMapV1({
        sourceRevisionId: input.prepared.sourceRevisionId,
        providerResult,
        locationByRef: input.prepared.locationByRef,
      });
      return {
        argumentMap,
        usage: {
          inputTokens: metadata.inputTokens,
          outputTokens: metadata.outputTokens,
          reasoningTokens: metadata.reasoningTokens,
        },
        execution: metadata,
      };
    } catch (error) {
      if (error instanceof GrantArgumentMapReferenceError) {
        throw new GrantArgumentMapExecutionError(
          "argument_map_reference_invalid",
          "ArgumentMap referenced a location outside the frozen scope.",
          { ...metadata, invalidReferencePaths: error.invalidPaths },
        );
      }
      const validationIssues = error instanceof z.ZodError
        ? safeGrantDiagnosticValidationIssues(error)
        : [{ path: "$", code: "syntax_error", rule: "json_parse_error", fieldClass: "unknown" as const }];
      throw new GrantArgumentMapExecutionError(
        "argument_map_structured_output_invalid",
        "ArgumentMap output did not satisfy the descriptive mapping contract.",
        { ...metadata, validationIssues },
      );
    }
  } catch (error) {
    if (error instanceof GrantArgumentMapExecutionError) throw error;
    throw new GrantArgumentMapExecutionError(
      "argument_map_provider_failure",
      providerFailure(error) && error instanceof Error ? error.message : "ArgumentMap provider request failed.",
      baseMetadata(),
    );
  }
}
