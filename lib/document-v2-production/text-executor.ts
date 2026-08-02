import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z, type ZodType } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { estimateModelCostUsd } from "@/lib/ai/cost";
import type {
  DocumentExecutionBudgetSnapshot,
  DocumentTextExecutionProfile,
} from "@/lib/document-v2/runtime/contracts";
import { sha256Canonical } from "@/lib/document-v2/runtime/canonical-hash";
import {
  createDocumentExecutionBudgetSnapshot,
  getDocumentOperationBudget,
  type DocumentOperationBudgetKey,
} from "@/lib/document-v2/runtime/token-budgets";
import {
  DOCUMENT_RESPONSE_PARSER_VERSION,
  DOCUMENT_RESPONSE_REPAIR_VERSION,
  parseStructuredResponse,
  type StructuredResponseCandidateNormalization,
  type StructuredResponseCandidateDiagnostic,
  type StructuredResponseRepairStep,
} from "./structured-response-parser";
import {
  protectResponseEvidence,
  revealResponseEvidence,
} from "./response-evidence";
import {
  normalizeChatCompletionResponse,
  normalizeParsedResponse,
  type NormalizedAuxiliaryContent,
  type NormalizedContentState,
} from "./provider-response-adapter";
import {
  createContentFingerprint,
  createLegacyExecutionFingerprint,
} from "./model-execution/fingerprints";
import {
  buildStructuredRecoveryInstruction,
  schemaIssuePaths,
  selectStructuredRecoveryAction,
  type StructuredRecoveryAction,
} from "./model-execution/recovery-engine";

export type DocumentModelUsage = {
  provider: "deepseek" | "openai";
  requestedModelId: string;
  actualModelId: string;
  providerRequestId?: string;
  operation: string;
  componentKey?: string;
  requestedMaxOutputTokens: number;
  effectiveMaxOutputTokens: number;
  expectedOutputTokens?: number;
  operationHardMaxOutputTokens?: number;
  inputFingerprint: string;
  generationConfigFingerprint: string;
  attemptNumber: number;
  attemptPurpose: "initial" | "regenerate" | "repair" | "capacity_escalation";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calculatedCostUsd: number;
  durationMs: number;
};

export type { StructuredRecoveryAction } from "./model-execution/recovery-engine";

export type StructuredOperationRecoveryPolicy = Readonly<{
  onNoJsonObject?: StructuredRecoveryAction;
  onTruncatedJson?: StructuredRecoveryAction;
  onJsonSyntaxError?: StructuredRecoveryAction;
  onSchemaValidationFailed?: StructuredRecoveryAction;
  onInvariantFailure?: StructuredRecoveryAction;
}>;

const DOCUMENT_MODEL_PRICING_VERSION = "document-model-pricing-v1";

export type DocumentStructuredGenerationInput<T> = {
    operation: string;
    budgetKey?: DocumentOperationBudgetKey;
    componentKey?: string;
    maxOutputTokens?: number;
    schemaName: string;
    schema: ZodType<T>;
    systemInstruction: string;
    userInstruction: string;
    validateCandidate?: (value: T) => void;
    normalizeCandidate?: (
      value: unknown,
    ) => StructuredResponseCandidateNormalization;
    recoveryPolicy?: StructuredOperationRecoveryPolicy;
};

export interface DocumentStructuredTextExecutor {
  readonly profile: DocumentTextExecutionProfile;
  generate<T>(input: DocumentStructuredGenerationInput<T>): Promise<T>;
}

export class DocumentModelExecutionInProgressError extends Error {
  constructor(readonly executionKey: string) {
    super(`Document model execution "${executionKey}" is already running.`);
    this.name = "DocumentModelExecutionInProgressError";
  }
}

export class DocumentModelExecutionRequiresReviewError extends Error {
  constructor(
    readonly executionKey: string,
    readonly executionStatus:
      | "response_received"
      | "validation_failed"
      | "failed"
      | "unknown_outcome",
  ) {
    super(
      `Document model execution "${executionKey}" requires review (${executionStatus}).`,
    );
    this.name = "DocumentModelExecutionRequiresReviewError";
  }
}

export type DocumentModelFailureCategory =
  | "empty_structured_output"
  | "missing_final_content"
  | "provider_empty_response"
  | "ambiguous_auxiliary_output"
  | "output_truncated"
  | "reasoning_budget_exhausted"
  | "split_required"
  | "no_json_object"
  | "truncated_json"
  | "json_syntax_error"
  | "ambiguous_json"
  | "schema_validation_failed"
  | "provider_rejected"
  | "transport_error"
  | "unknown_outcome";

export class DocumentModelOperationError extends Error {
  constructor(
    message: string,
    readonly failureCategory: DocumentModelFailureCategory,
    readonly operation?: string,
    readonly recoveryEvidence?: Readonly<{
      providerContent: string;
      candidateDiagnostics: ReadonlyArray<StructuredResponseCandidateDiagnostic>;
    }>,
  ) {
    super(message);
    this.name = "DocumentModelOperationError";
  }
}

type StoredExecution = {
  status:
    | "running"
    | "request_started"
    | "response_received"
    | "raw_saved"
    | "succeeded"
    | "validation_failed"
    | "failed"
    | "unknown_outcome";
  raw_response: unknown;
  raw_content_encrypted: string | null;
  auxiliary_content_encrypted: string | null;
  response_source: string | null;
  parser_version: string | null;
  schema_version: string | null;
  lease_expires_at: string | null;
};

export class ProviderDocumentTextExecutor
  implements DocumentStructuredTextExecutor
{
  private readonly client: OpenAI;

  constructor(
    readonly profile: DocumentTextExecutionProfile,
    private readonly onUsage?: (usage: DocumentModelUsage) => Promise<void>,
    private readonly persistence?: {
      supabase: SupabaseClient;
      jobId: string;
    },
    private readonly executionBudget: DocumentExecutionBudgetSnapshot =
      createDocumentExecutionBudgetSnapshot(profile),
  ) {
    const apiKey =
      profile.provider === "deepseek"
        ? process.env.DEEPSEEK_API_KEY?.trim()
        : process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        `${profile.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"} is not configured.`,
      );
    }
    this.client = new OpenAI({
      apiKey,
      ...(profile.provider === "deepseek"
        ? {
            baseURL:
              process.env.DEEPSEEK_BASE_URL?.trim() ||
              "https://api.deepseek.com",
          }
        : {}),
      timeout: 75_000,
      maxRetries: 0,
    });
  }

  async generate<T>(input: DocumentStructuredGenerationInput<T>): Promise<T> {
    return this.generateAttempt(input, {
      attemptNumber: 1,
      attemptPurpose: "initial",
    });
  }

  private async generateAttempt<T>(
    input: DocumentStructuredGenerationInput<T>,
    attempt: {
      attemptNumber: number;
      attemptPurpose:
        | "initial"
        | "regenerate"
        | "repair"
        | "capacity_escalation";
      parentExecutionKey?: string;
      maxOutputTokensOverride?: number;
      escalationReason?: string;
      recoveryContext?: Readonly<{
        failureCategory: DocumentModelFailureCategory;
        providerContent: string;
        schemaIssuePaths: ReadonlyArray<string>;
      }>;
    },
  ): Promise<T> {
    const startedAt = Date.now();
    const operationBudget = input.budgetKey
      ? getDocumentOperationBudget(this.executionBudget, input.budgetKey)
      : undefined;
    const requestedMaxOutputTokens =
      attempt.maxOutputTokensOverride ??
      input.maxOutputTokens ??
      operationBudget?.effectivePreferredMaxOutputTokens ??
      this.profile.maxOutputTokens;
    const effectiveMaxOutputTokens = Math.min(
      requestedMaxOutputTokens,
      operationBudget?.effectiveHardMaxOutputTokens ??
        this.executionBudget.modelCapability.maxOutputTokens,
      this.executionBudget.modelCapability.maxOutputTokens,
      this.executionBudget.productMaxOutputTokensPerOperation,
    );
    const effectiveReasoningEffort =
      operationBudget?.reasoningPolicy &&
      operationBudget.reasoningPolicy !== "inherit"
        ? operationBudget.reasoningPolicy
        : (this.profile.reasoningEffort ?? "none");
    const inputFingerprint = createContentFingerprint({
      operation: input.operation,
      componentKey: input.componentKey,
      schemaName: input.schemaName,
      systemInstruction: input.systemInstruction,
      userInstruction: input.userInstruction,
    });
    const schemaVersion = sha256Canonical(z.toJSONSchema(input.schema));
    const generationConfigFingerprint = sha256Canonical({
      provider: this.profile.provider,
      requestedModelId: this.profile.requestedModelId,
      resolvedModelId: this.profile.resolvedModelId,
      schemaVersion,
      budgetKey: input.budgetKey,
      effectiveMaxOutputTokens,
      effectiveReasoningEffort,
      operationBudgetPolicyVersion:
        this.executionBudget.operationBudgetPolicyVersion,
      modelCapabilityVersion:
        this.executionBudget.modelCapability.capabilityVersion,
      attemptNumber: attempt.attemptNumber,
      attemptPurpose: attempt.attemptPurpose,
      recoveryContextFingerprint: attempt.recoveryContext
        ? sha256Canonical(attempt.recoveryContext)
        : null,
    });
    const executionKey = sha256Canonical({
      jobId: this.persistence?.jobId ?? "unpersisted",
      componentKey: input.componentKey ?? "document",
      operation: input.operation,
      inputFingerprint,
      generationConfigFingerprint,
    });
    const leaseExpiresAt = new Date(Date.now() + 90_000).toISOString();
    if (this.persistence) {
      const existing = await this.getExecution(executionKey);
      if (!existing && attempt.attemptNumber === 1) {
        const legacyMaxOutputTokens = Math.min(
          input.maxOutputTokens ?? this.profile.maxOutputTokens,
          this.profile.maxOutputTokens,
        );
        const legacyInputFingerprint = createLegacyExecutionFingerprint({
          profile: this.profile,
          operation: input.operation,
          componentKey: input.componentKey,
          schemaName: input.schemaName,
          systemInstruction: input.systemInstruction,
          userInstruction: input.userInstruction,
          maxOutputTokens: legacyMaxOutputTokens,
        });
        const legacyExecutionKey = sha256Canonical({
          jobId: this.persistence.jobId,
          componentKey: input.componentKey ?? "document",
          operation: input.operation,
          inputFingerprint: legacyInputFingerprint,
        });
        const legacyExecution = await this.getExecution(legacyExecutionKey);
        if (
          legacyExecution?.status === "succeeded" ||
          legacyExecution?.status === "raw_saved"
        ) {
          return this.parseStoredResponse({
            executionKey: legacyExecutionKey,
            rawResponse: legacyExecution.raw_response,
            storedStatus: legacyExecution.status,
            schema: input.schema,
            normalizeCandidate: input.normalizeCandidate,
          });
        }
      }
      if (existing?.status === "succeeded") {
        return this.parseStoredResponse({
          executionKey,
          rawResponse: existing.raw_response,
          storedStatus: "succeeded",
          schema: input.schema,
          normalizeCandidate: input.normalizeCandidate,
        });
      }
      if (existing?.status === "raw_saved") {
        return this.parseStoredResponse({
          executionKey,
          rawResponse: existing.raw_response,
          storedStatus: "raw_saved",
          schema: input.schema,
          normalizeCandidate: input.normalizeCandidate,
        });
      }
      if (existing?.status === "response_received") {
        const recovered = await this.reparseStoredProviderContent({
          executionKey,
          execution: existing,
          schema: input.schema,
          schemaVersion,
          operation: input.operation,
          validateCandidate: input.validateCandidate,
          normalizeCandidate: input.normalizeCandidate,
        });
        if (recovered !== undefined) return recovered;
        throw new DocumentModelExecutionRequiresReviewError(
          executionKey,
          "response_received",
        );
      }
      if (existing?.status === "failed") {
        const parserChanged =
          existing.parser_version !== DOCUMENT_RESPONSE_PARSER_VERSION ||
          existing.schema_version !== schemaVersion;
        if (parserChanged) {
          const recovered = await this.reparseStoredProviderContent({
            executionKey,
            execution: existing,
            schema: input.schema,
            schemaVersion,
            operation: input.operation,
            validateCandidate: input.validateCandidate,
            normalizeCandidate: input.normalizeCandidate,
          });
          if (recovered !== undefined) return recovered;
        }
      }
      if (
        existing?.status === "validation_failed" &&
        (existing.parser_version !== DOCUMENT_RESPONSE_PARSER_VERSION ||
          existing.schema_version !== schemaVersion)
      ) {
        const recovered = await this.reparseStoredProviderContent({
          executionKey,
          execution: existing,
          schema: input.schema,
          schemaVersion,
          operation: input.operation,
          validateCandidate: input.validateCandidate,
          normalizeCandidate: input.normalizeCandidate,
        });
        if (recovered !== undefined) return recovered;
      }
      if (
        existing?.status === "validation_failed" ||
        existing?.status === "unknown_outcome"
      ) {
        throw new DocumentModelExecutionRequiresReviewError(
          executionKey,
          existing.status,
        );
      }
      if (
        (existing?.status === "running" ||
          existing?.status === "request_started") &&
        existing.lease_expires_at &&
        Date.parse(existing.lease_expires_at) <= Date.now()
      ) {
        await this.mustUpdateExecution(
          executionKey,
          {
            status: "unknown_outcome",
            failure_category: "execution_lease_expired",
            error_message:
              "The worker lease expired while the provider request outcome was not durable.",
            completed_at: new Date().toISOString(),
          },
          [existing.status],
        );
        throw new DocumentModelExecutionRequiresReviewError(
          executionKey,
          "unknown_outcome",
        );
      }
      if (
        existing?.status === "running" ||
        existing?.status === "request_started"
      ) {
        throw new DocumentModelExecutionInProgressError(executionKey);
      }
      if (existing?.status === "failed") {
        throw new DocumentModelExecutionRequiresReviewError(
          executionKey,
          "failed",
        );
      }
      const { error } = await this.persistence.supabase
        .from("document_v2_model_executions")
        .insert({
          execution_key: executionKey,
          job_id: this.persistence.jobId,
          component_key: input.componentKey ?? null,
          operation: input.operation,
          input_fingerprint: inputFingerprint,
          content_input_fingerprint: inputFingerprint,
          generation_config_fingerprint: generationConfigFingerprint,
          attempt_number: attempt.attemptNumber,
          parent_execution_key: attempt.parentExecutionKey ?? null,
          escalation_reason: attempt.escalationReason ?? null,
          budget_escalation_count: attempt.attemptNumber - 1,
          expected_output_tokens:
            operationBudget?.expectedOutputTokens ?? null,
          model_physical_max_output_tokens:
            this.executionBudget.modelCapability.maxOutputTokens,
          product_max_output_tokens:
            this.executionBudget.productMaxOutputTokensPerOperation,
          operation_hard_max_output_tokens:
            operationBudget?.hardMaxOutputTokens ?? null,
          generation_budget_policy_version:
            this.executionBudget.operationBudgetPolicyVersion,
          model_capability_version:
            this.executionBudget.modelCapability.capabilityVersion,
          provider: this.profile.provider,
          requested_model_id: this.profile.requestedModelId,
          resolved_model_id: this.profile.resolvedModelId,
          requested_reasoning_effort: this.profile.reasoningEffort,
          effective_reasoning_effort: effectiveReasoningEffort,
          status: "running",
          lease_expires_at: leaseExpiresAt,
          started_at: new Date().toISOString(),
        });
      if (error) {
        const raced = await this.getExecution(executionKey);
        if (raced?.status === "succeeded") {
          return this.parseStoredResponse({
            executionKey,
            rawResponse: raced.raw_response,
            storedStatus: "succeeded",
            schema: input.schema,
            normalizeCandidate: input.normalizeCandidate,
          });
        }
        if (raced?.status === "raw_saved") {
          return this.parseStoredResponse({
            executionKey,
            rawResponse: raced.raw_response,
            storedStatus: "raw_saved",
            schema: input.schema,
            normalizeCandidate: input.normalizeCandidate,
          });
        }
        throw new DocumentModelExecutionInProgressError(executionKey);
      }
    }
    let parsed: T;
    let rawResponse: unknown;
    let actualModelId = this.profile.resolvedModelId;
    let providerRequestId: string | undefined;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let finishReason: string | null = null;
    let choiceCount = 0;
    let contentState: NormalizedContentState = "missing";
    let contentLength = 0;
    let reasoningContentPresent = false;
    let reasoningContentLength = 0;
    let refusalPresent = false;
    let toolCallCount = 0;
    let providerContent: string | undefined;
    let auxiliaryContent: NormalizedAuxiliaryContent[] = [];
    let responseSource: "content" | "auxiliary_content" | null = null;
    let recoveryMode: string | null = null;
    const boundedRecoveryInstruction = buildStructuredRecoveryInstruction(attempt);
    const effectiveSystemInstruction = boundedRecoveryInstruction
      ? `${input.systemInstruction}\n\n${boundedRecoveryInstruction}`
      : input.systemInstruction;

    try {
      if (this.persistence) {
        await this.mustUpdateExecution(
          executionKey,
          {
            status: "request_started",
            lease_expires_at: leaseExpiresAt,
          },
          ["running"],
        );
      }
      if (this.profile.provider === "openai") {
        const response = await this.client.responses.parse({
          model: this.profile.resolvedModelId,
          instructions: effectiveSystemInstruction,
          input: input.userInstruction,
          max_output_tokens: effectiveMaxOutputTokens,
          reasoning: { effort: effectiveReasoningEffort },
          text: {
            format: zodTextFormat(input.schema, input.schemaName),
          },
        });
        const normalized = normalizeParsedResponse(response);
        actualModelId = normalized.actualModelId ?? actualModelId;
        providerRequestId = normalized.providerRequestId;
        inputTokens = normalized.usage.inputTokens;
        cachedInputTokens = normalized.usage.cachedInputTokens;
        outputTokens = normalized.usage.outputTokens;
        reasoningTokens = normalized.usage.reasoningTokens;
        choiceCount = normalized.choiceCount;
        finishReason = normalized.finishReason;
        contentState = normalized.contentState;
        contentLength = normalized.content?.length ?? 0;
        refusalPresent = normalized.refusalPresent;
        toolCallCount = normalized.toolCallCount;
        rawResponse = normalized.parsedResponse;
        providerContent = normalized.content ?? undefined;
        auxiliaryContent = normalized.auxiliaryContent;
      } else {
        const response = await this.client.chat.completions.create({
          model: this.profile.resolvedModelId,
          max_tokens: effectiveMaxOutputTokens,
          reasoning_effort: effectiveReasoningEffort,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                effectiveSystemInstruction,
                `Return one JSON object matching this schema exactly: ${JSON.stringify(z.toJSONSchema(input.schema))}`,
                "Return only that JSON object in message.content. Do not include Markdown fences, explanations, examples, introductions, or trailing text. Do not place the final answer only in reasoning_content.",
              ].join("\n\n"),
            },
            { role: "user", content: input.userInstruction },
          ],
        });
        const normalized = normalizeChatCompletionResponse(response);
        actualModelId = normalized.actualModelId ?? actualModelId;
        providerRequestId = normalized.providerRequestId;
        inputTokens = normalized.usage.inputTokens;
        cachedInputTokens = normalized.usage.cachedInputTokens;
        outputTokens = normalized.usage.outputTokens;
        reasoningTokens = normalized.usage.reasoningTokens;
        choiceCount = normalized.choiceCount;
        finishReason = normalized.finishReason;
        contentState = normalized.contentState;
        contentLength = normalized.content?.length ?? 0;
        auxiliaryContent = normalized.auxiliaryContent;
        reasoningContentPresent = auxiliaryContent.some(
          (item) => item.type === "reasoning",
        );
        reasoningContentLength = auxiliaryContent
          .filter((item) => item.type === "reasoning")
          .reduce((total, item) => total + item.content.length, 0);
        refusalPresent = normalized.refusalPresent;
        toolCallCount = normalized.toolCallCount;
        providerContent = normalized.content ?? undefined;
      }

      const responseReceivedAt = new Date().toISOString();
      const calculatedCostUsd = estimateModelCostUsd(actualModelId, {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
      });
      const evidence = providerContent
        ? protectResponseEvidence(providerContent)
        : null;
      const auxiliaryText = auxiliaryContent
        .map((item) => item.content)
        .filter(Boolean)
        .join("\n\n");
      const auxiliaryEvidence = auxiliaryText
        ? protectResponseEvidence(auxiliaryText)
        : null;
      if (this.persistence) {
        await this.mustUpdateExecution(
          executionKey,
          {
            status: "response_received",
            actual_model_id: actualModelId,
            provider_request_id: providerRequestId ?? null,
            input_tokens: inputTokens,
            cached_input_tokens: cachedInputTokens,
            output_tokens: outputTokens,
            reasoning_tokens: reasoningTokens,
            visible_output_tokens: Math.max(0, outputTokens - reasoningTokens),
            reasoning_tokens_observed: reasoningTokens > 0,
            calculated_cost_usd: calculatedCostUsd,
            pricing_version: DOCUMENT_MODEL_PRICING_VERSION,
            cost_status: "calculated",
            response_received_at: responseReceivedAt,
            finish_reason: finishReason,
            choice_count: choiceCount,
            content_state: contentState,
            content_length: contentLength,
            reasoning_content_present: reasoningContentPresent,
            reasoning_content_length: reasoningContentLength,
            refusal_present: refusalPresent,
            tool_call_count: toolCallCount,
            raw_content_encrypted: evidence?.encryptedContent ?? null,
            raw_content_hash: evidence?.contentHash ?? null,
            sanitized_preview: evidence?.sanitizedPreview ?? null,
            auxiliary_content_encrypted:
              auxiliaryEvidence?.encryptedContent ?? null,
            auxiliary_content_hash: auxiliaryEvidence?.contentHash ?? null,
            auxiliary_content_length: auxiliaryText.length,
            auxiliary_content_types: auxiliaryContent.map((item) => item.type),
            provider_response_saved_at: responseReceivedAt,
            requested_max_tokens: requestedMaxOutputTokens,
            effective_max_tokens: effectiveMaxOutputTokens,
            parser_version: DOCUMENT_RESPONSE_PARSER_VERSION,
            repair_pipeline_version: DOCUMENT_RESPONSE_REPAIR_VERSION,
            schema_version: schemaVersion,
          },
          ["request_started"],
        );
      }
      const reasoningBudgetExhausted =
        (finishReason === "length" || finishReason === "incomplete") &&
        outputTokens > 0 &&
        reasoningTokens / outputTokens >= 0.8 &&
        contentLength < 64;
      if (reasoningBudgetExhausted) {
        throw new DocumentModelOperationError(
          "The provider consumed the structured-output budget in reasoning and returned no publishable JSON content.",
          "reasoning_budget_exhausted",
          input.operation,
        );
      }
      if (finishReason === "length" || finishReason === "incomplete") {
        throw new DocumentModelOperationError(
          "The document model output was truncated before a publishable result was available.",
          "output_truncated",
          input.operation,
        );
      }
      let parseContent = providerContent;
      if (!parseContent && auxiliaryText) {
        parseContent = auxiliaryText;
        responseSource = "auxiliary_content";
        recoveryMode = "unique_valid_auxiliary_candidate";
      } else if (parseContent) {
        responseSource = "content";
      }
      if (!parseContent) {
        throw new DocumentModelOperationError(
          "The provider returned neither final content nor recoverable auxiliary content.",
          "provider_empty_response",
          input.operation,
        );
      }
      if (parseContent !== undefined) {
        const parseStartedAt = new Date().toISOString();
        const parseResult = parseStructuredResponse({
          content: parseContent,
          schema: input.schema,
          validateCandidate: input.validateCandidate,
          normalizeCandidate: input.normalizeCandidate,
        });
        const parseCompletedAt = new Date().toISOString();
        if (!parseResult.ok) {
          const failureCategory =
            responseSource === "auxiliary_content"
              ? parseResult.failureCategory === "ambiguous_json"
                ? "ambiguous_auxiliary_output"
                : "missing_final_content"
              : parseResult.failureCategory;
          if (this.persistence) {
            await this.mustUpdateExecution(
              executionKey,
              {
                status:
                  parseResult.failureCategory === "schema_validation_failed"
                    ? "validation_failed"
                    : "failed",
                failure_category: failureCategory,
                error_message: parseResult.message.slice(0, 2_000),
                parse_status: "failed",
                parse_error_message:
                  parseResult.parseErrorMessage?.slice(0, 2_000) ?? null,
                parse_error_position: parseResult.parseErrorPosition ?? null,
                candidate_count: parseResult.candidateDiagnostics.length,
                json_valid_candidate_count:
                  parseResult.candidateDiagnostics.filter(
                    (candidate) => candidate.parseStatus === "valid",
                  ).length,
                schema_valid_candidate_count:
                  parseResult.candidateDiagnostics.filter(
                    (candidate) => candidate.schemaStatus === "valid",
                  ).length,
                candidate_diagnostics: parseResult.candidateDiagnostics,
                repair_steps: parseResult.repairSteps,
                parse_started_at: parseStartedAt,
                parse_completed_at: parseCompletedAt,
                response_source: responseSource,
                recovery_mode: recoveryMode,
                lease_expires_at: null,
                completed_at: parseCompletedAt,
              },
              ["response_received"],
            );
          }
          throw new DocumentModelOperationError(
            responseSource === "auxiliary_content"
              ? "The provider returned auxiliary reasoning without one publishable final result."
              : parseResult.message,
            failureCategory,
            input.operation,
            {
              providerContent: parseContent,
              candidateDiagnostics: parseResult.candidateDiagnostics,
            },
          );
        }
        rawResponse = parseResult.parsedResponse;
        parsed = parseResult.value;
        if (this.persistence) {
          await this.persistParseDiagnostics(executionKey, {
            repairSteps: parseResult.repairSteps,
            candidateDiagnostics: parseResult.candidateDiagnostics,
            parseStartedAt,
            parseCompletedAt,
          });
          await this.mustUpdateExecution(
            executionKey,
            {
              response_source: responseSource,
              recovery_mode: recoveryMode,
            },
            ["response_received"],
          );
        }
      }

      if (this.persistence) {
        await this.mustUpdateExecution(
          executionKey,
          {
            status: "raw_saved",
            raw_response: rawResponse,
            actual_model_id: actualModelId,
            provider_request_id: providerRequestId ?? null,
            input_tokens: inputTokens,
            cached_input_tokens: cachedInputTokens,
            output_tokens: outputTokens,
            reasoning_tokens: reasoningTokens,
            raw_saved_at: new Date().toISOString(),
            parsed_response: rawResponse,
            lease_expires_at: null,
          },
          ["response_received"],
        );
      }
      const validation = input.schema.safeParse(rawResponse);
      if (!validation.success) {
        if (this.persistence) {
          await this.mustUpdateExecution(
            executionKey,
            {
              status: "validation_failed",
              failure_category: "schema_validation_failed",
              error_message: validation.error.message.slice(0, 2_000),
              completed_at: new Date().toISOString(),
            },
            ["raw_saved"],
          );
        }
        throw validation.error;
      }
      parsed = validation.data;
      if (this.persistence) {
        await this.mustUpdateExecution(
          executionKey,
          {
            status: "succeeded",
            completed_at: new Date().toISOString(),
          },
          ["raw_saved"],
        );
      }
      await this.onUsage?.({
        provider: this.profile.provider,
        requestedModelId: this.profile.requestedModelId,
        actualModelId,
        providerRequestId,
        operation: input.operation,
        componentKey: input.componentKey,
        requestedMaxOutputTokens,
        effectiveMaxOutputTokens,
        expectedOutputTokens: operationBudget?.expectedOutputTokens,
        operationHardMaxOutputTokens:
          operationBudget?.effectiveHardMaxOutputTokens,
        inputFingerprint,
        generationConfigFingerprint,
        attemptNumber: attempt.attemptNumber,
        attemptPurpose: attempt.attemptPurpose,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        calculatedCostUsd,
        durationMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      const outputWasTruncated =
        error instanceof DocumentModelOperationError &&
        error.failureCategory === "output_truncated";
      const canEscalate =
        outputWasTruncated &&
        operationBudget !== undefined &&
        attempt.attemptNumber === 1 &&
        operationBudget.escalationAllowed === true &&
        effectiveMaxOutputTokens <
          operationBudget.effectiveHardMaxOutputTokens &&
        (outputTokens === 0 ||
          outputTokens / effectiveMaxOutputTokens >= 0.8);
      const terminalFailure =
        outputWasTruncated && operationBudget && !canEscalate
          ? new DocumentModelOperationError(
              "The document model output was truncated after the allowed capacity strategy; this semantic component must be split.",
              "split_required",
              input.operation,
            )
          : error;
      if (this.persistence) {
        const current = await this.getExecution(executionKey);
        if (
          current?.status === "running" ||
          current?.status === "request_started" ||
          current?.status === "response_received"
        ) {
          const knownFailure =
            terminalFailure instanceof DocumentModelOperationError
              ? terminalFailure.failureCategory
              : null;
          await this.mustUpdateExecution(
            executionKey,
            {
              status:
                current.status === "request_started"
                  ? "unknown_outcome"
                  : "failed",
              failure_category:
                current.status === "request_started"
                  ? "unknown_outcome"
                  : knownFailure ??
                    (current.status === "running"
                      ? "transport_error"
                      : "provider_rejected"),
              error_message:
                terminalFailure instanceof Error
                  ? terminalFailure.message.slice(0, 2_000)
                  : String(terminalFailure).slice(0, 2_000),
              lease_expires_at: null,
              completed_at: new Date().toISOString(),
            },
            [current.status],
          );
        }
      }
      if (outputWasTruncated) {
        if (!operationBudget) throw error;
        if (canEscalate) {
          return this.generateAttempt(input, {
            attemptNumber: 2,
            attemptPurpose: "capacity_escalation",
            parentExecutionKey: executionKey,
            maxOutputTokensOverride:
              operationBudget.effectiveHardMaxOutputTokens,
            escalationReason: "output_truncated_near_budget",
          });
        }
        throw terminalFailure;
      }
      const structuredRecoveryAction =
        error instanceof DocumentModelOperationError
          ? selectStructuredRecoveryAction({
              failureCategory: error.failureCategory,
              diagnostics: error.recoveryEvidence?.candidateDiagnostics ?? [],
              policy: input.recoveryPolicy,
            })
          : "pause";
      if (
        attempt.attemptPurpose === "initial" &&
        (structuredRecoveryAction === "regenerate_once" ||
          structuredRecoveryAction === "repair_once") &&
        error instanceof DocumentModelOperationError
      ) {
        const paths = schemaIssuePaths(
          error.recoveryEvidence?.candidateDiagnostics ?? [],
        );
        return this.generateAttempt(input, {
          attemptNumber: 2,
          attemptPurpose:
            structuredRecoveryAction === "repair_once"
              ? "repair"
              : "regenerate",
          parentExecutionKey: executionKey,
          escalationReason:
            structuredRecoveryAction === "repair_once"
              ? `structured_repair:${error.failureCategory}`
              : `structured_regenerate:${error.failureCategory}`,
          recoveryContext:
            structuredRecoveryAction === "repair_once" &&
            error.recoveryEvidence
              ? {
                  failureCategory: error.failureCategory,
                  providerContent: error.recoveryEvidence.providerContent,
                  schemaIssuePaths: paths,
                }
              : undefined,
        });
      }
      throw error;
    }
  }

  private async reparseStoredProviderContent<T>(input: {
    executionKey: string;
    execution: StoredExecution;
    schema: ZodType<T>;
    schemaVersion: string;
    operation: string;
    validateCandidate?: (value: T) => void;
    normalizeCandidate?: (
      value: unknown,
    ) => StructuredResponseCandidateNormalization;
  }): Promise<T | undefined> {
    const encryptedContent =
      input.execution.raw_content_encrypted ??
      input.execution.auxiliary_content_encrypted;
    const responseSource = input.execution.raw_content_encrypted
      ? "content"
      : "auxiliary_content";
    if (!encryptedContent) return undefined;
    const content = revealResponseEvidence(
      encryptedContent,
    );
    if (content === null) return undefined;
    const parseStartedAt = new Date().toISOString();
    const result = parseStructuredResponse({
      content,
      schema: input.schema,
      validateCandidate: input.validateCandidate,
      normalizeCandidate: input.normalizeCandidate,
    });
    const parseCompletedAt = new Date().toISOString();
    const diagnostics = {
      parser_version: DOCUMENT_RESPONSE_PARSER_VERSION,
      repair_pipeline_version: DOCUMENT_RESPONSE_REPAIR_VERSION,
      schema_version: input.schemaVersion,
      parse_started_at: parseStartedAt,
      parse_completed_at: parseCompletedAt,
      repair_steps: result.repairSteps,
      candidate_count: result.candidateDiagnostics.length,
      json_valid_candidate_count: result.candidateDiagnostics.filter(
        (candidate) => candidate.parseStatus === "valid",
      ).length,
      schema_valid_candidate_count: result.candidateDiagnostics.filter(
        (candidate) => candidate.schemaStatus === "valid",
      ).length,
      candidate_diagnostics: result.candidateDiagnostics,
      response_source: responseSource,
      recovery_mode:
        responseSource === "auxiliary_content"
          ? "unique_valid_auxiliary_candidate"
          : "stored_response_reparse",
    };
    if (!result.ok) {
      await this.mustUpdateExecution(
        input.executionKey,
        {
          ...diagnostics,
          status:
            result.failureCategory === "schema_validation_failed"
              ? "validation_failed"
              : "failed",
          failure_category: result.failureCategory,
          error_message: result.message.slice(0, 2_000),
          parse_status: "failed",
          parse_error_message:
            result.parseErrorMessage?.slice(0, 2_000) ?? null,
          parse_error_position: result.parseErrorPosition ?? null,
          completed_at: parseCompletedAt,
        },
        [input.execution.status],
      );
      throw new DocumentModelOperationError(
        result.message,
        result.failureCategory,
        input.operation,
      );
    }
    await this.mustUpdateExecution(
      input.executionKey,
      {
        ...diagnostics,
        status: "raw_saved",
        raw_response: result.parsedResponse,
        parsed_response: result.parsedResponse,
        raw_saved_at: parseCompletedAt,
        parse_status: "succeeded",
        parse_error_message: null,
        parse_error_position: null,
        failure_category: null,
        error_message: null,
        completed_at: null,
      },
      [input.execution.status],
    );
    await this.mustUpdateExecution(
      input.executionKey,
      { status: "succeeded", completed_at: new Date().toISOString() },
      ["raw_saved"],
    );
    return result.value;
  }

  private async persistParseDiagnostics(
    executionKey: string,
    input: {
      repairSteps: StructuredResponseRepairStep[];
      candidateDiagnostics: StructuredResponseCandidateDiagnostic[];
      parseStartedAt: string;
      parseCompletedAt: string;
    },
  ) {
    await this.mustUpdateExecution(
      executionKey,
      {
        parse_status: "succeeded",
        parse_error_message: null,
        parse_error_position: null,
        candidate_count: input.candidateDiagnostics.length,
        json_valid_candidate_count: input.candidateDiagnostics.filter(
          (candidate) => candidate.parseStatus === "valid",
        ).length,
        schema_valid_candidate_count: input.candidateDiagnostics.filter(
          (candidate) => candidate.schemaStatus === "valid",
        ).length,
        candidate_diagnostics: input.candidateDiagnostics,
        repair_steps: input.repairSteps,
        parse_started_at: input.parseStartedAt,
        parse_completed_at: input.parseCompletedAt,
      },
      ["response_received"],
    );
  }

  private async getExecution(
    executionKey: string,
  ): Promise<StoredExecution | null> {
    if (!this.persistence) return null;
    const { data, error } = await this.persistence.supabase
      .from("document_v2_model_executions")
      .select(
        "status,raw_response,raw_content_encrypted,auxiliary_content_encrypted,response_source,parser_version,schema_version,lease_expires_at",
      )
      .eq("execution_key", executionKey)
      .maybeSingle();
    if (error) throw error;
    return data as StoredExecution | null;
  }

  private async parseStoredResponse<T>(input: {
    executionKey: string;
    rawResponse: unknown;
    storedStatus: "raw_saved" | "succeeded";
    schema: ZodType<T>;
    normalizeCandidate?: (
      value: unknown,
    ) => StructuredResponseCandidateNormalization;
  }): Promise<T> {
    const normalized = input.normalizeCandidate?.(input.rawResponse) ?? {
      value: input.rawResponse,
    };
    const parsed = input.schema.safeParse(normalized.value);
    if (!parsed.success) {
      await this.mustUpdateExecution(
        input.executionKey,
        {
          status: "validation_failed",
          failure_category: "schema_validation_failed",
          error_message: parsed.error.message.slice(0, 2_000),
          completed_at: new Date().toISOString(),
        },
        [input.storedStatus],
      );
      throw parsed.error;
    }
    if (input.storedStatus === "raw_saved") {
      await this.mustUpdateExecution(
        input.executionKey,
        {
          status: "succeeded",
          completed_at: new Date().toISOString(),
        },
        ["raw_saved"],
      );
    }
    return parsed.data;
  }

  private async mustUpdateExecution(
    executionKey: string,
    values: Record<string, unknown>,
    expectedStatuses: StoredExecution["status"][],
  ): Promise<void> {
    if (!this.persistence) return;
    const { data, error } = await this.persistence.supabase
      .from("document_v2_model_executions")
      .update(values)
      .eq("execution_key", executionKey)
      .in("status", expectedStatuses)
      .select("execution_key")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        `Model execution "${executionKey}" changed before it could be updated.`,
      );
    }
  }
}
