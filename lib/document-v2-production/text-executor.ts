import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z, type ZodType } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { estimateModelCostUsd } from "@/lib/ai/cost";
import type { DocumentTextExecutionProfile } from "@/lib/document-v2/runtime/contracts";
import { sha256Canonical } from "@/lib/document-v2/runtime/canonical-hash";

export type DocumentModelUsage = {
  provider: "deepseek" | "openai";
  requestedModelId: string;
  actualModelId: string;
  providerRequestId?: string;
  operation: string;
  componentKey?: string;
  inputFingerprint: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calculatedCostUsd: number;
  durationMs: number;
};

export interface DocumentStructuredTextExecutor {
  readonly profile: DocumentTextExecutionProfile;
  generate<T>(input: {
    operation: string;
    componentKey?: string;
    schemaName: string;
    schema: ZodType<T>;
    systemInstruction: string;
    userInstruction: string;
  }): Promise<T>;
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
  | "invalid_json"
  | "schema_validation_failed"
  | "provider_rejected"
  | "transport_error"
  | "unknown_outcome";

export class DocumentModelOperationError extends Error {
  constructor(
    message: string,
    readonly failureCategory: DocumentModelFailureCategory,
    readonly operation?: string,
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
  lease_expires_at: string | null;
};

function fingerprint(input: {
  profile: DocumentTextExecutionProfile;
  operation: string;
  componentKey?: string;
  schemaName: string;
  systemInstruction: string;
  userInstruction: string;
}) {
  return sha256Canonical(input);
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new DocumentModelOperationError(
        "The model returned no JSON object.",
        "invalid_json",
      );
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new DocumentModelOperationError(
        "The model returned invalid JSON.",
        "invalid_json",
      );
    }
  }
}

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

  async generate<T>(input: {
    operation: string;
    componentKey?: string;
    schemaName: string;
    schema: ZodType<T>;
    systemInstruction: string;
    userInstruction: string;
  }): Promise<T> {
    const startedAt = Date.now();
    const inputFingerprint = fingerprint({
      profile: this.profile,
      operation: input.operation,
      componentKey: input.componentKey,
      schemaName: input.schemaName,
      systemInstruction: input.systemInstruction,
      userInstruction: input.userInstruction,
    });
    const executionKey = sha256Canonical({
      jobId: this.persistence?.jobId ?? "unpersisted",
      componentKey: input.componentKey ?? "document",
      operation: input.operation,
      inputFingerprint,
    });
    const leaseExpiresAt = new Date(Date.now() + 90_000).toISOString();
    if (this.persistence) {
      const existing = await this.getExecution(executionKey);
      if (existing?.status === "succeeded") {
        return this.parseStoredResponse({
          executionKey,
          rawResponse: existing.raw_response,
          storedStatus: "succeeded",
          schema: input.schema,
        });
      }
      if (existing?.status === "raw_saved") {
        return this.parseStoredResponse({
          executionKey,
          rawResponse: existing.raw_response,
          storedStatus: "raw_saved",
          schema: input.schema,
        });
      }
      if (
        existing?.status === "response_received" ||
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
          provider: this.profile.provider,
          requested_model_id: this.profile.requestedModelId,
          resolved_model_id: this.profile.resolvedModelId,
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
          });
        }
        if (raced?.status === "raw_saved") {
          return this.parseStoredResponse({
            executionKey,
            rawResponse: raced.raw_response,
            storedStatus: "raw_saved",
            schema: input.schema,
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
    let contentState: "present" | "empty" | "null" | "missing" = "missing";
    let contentLength = 0;
    let reasoningContentPresent = false;
    let refusalPresent = false;
    let toolCallCount = 0;
    let deepSeekContent: string | undefined;

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
          instructions: input.systemInstruction,
          input: input.userInstruction,
          max_output_tokens: this.profile.maxOutputTokens,
          text: {
            format: zodTextFormat(input.schema, input.schemaName),
          },
        });
        actualModelId = response.model ?? actualModelId;
        providerRequestId = response.id;
        inputTokens = response.usage?.input_tokens ?? 0;
        cachedInputTokens =
          response.usage?.input_tokens_details?.cached_tokens ?? 0;
        outputTokens = response.usage?.output_tokens ?? 0;
        reasoningTokens =
          response.usage?.output_tokens_details?.reasoning_tokens ?? 0;
        choiceCount = response.output?.length ?? 0;
        finishReason = response.status ?? null;
        contentState = response.output_parsed ? "present" : "null";
        contentLength = response.output_parsed
          ? JSON.stringify(response.output_parsed).length
          : 0;
        refusalPresent = response.output?.some(
          (item) =>
            "content" in item &&
            Array.isArray(item.content) &&
            item.content.some((content) => content.type === "refusal"),
        ) ?? false;
        rawResponse = response.output_parsed;
      } else {
        const response = await this.client.chat.completions.create({
          model: this.profile.resolvedModelId,
          max_tokens: this.profile.maxOutputTokens,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                input.systemInstruction,
                `Return one JSON object matching this schema exactly: ${JSON.stringify(z.toJSONSchema(input.schema))}`,
              ].join("\n\n"),
            },
            { role: "user", content: input.userInstruction },
          ],
        });
        const choice = response.choices[0];
        const message = choice?.message as
          | (typeof choice.message & {
              reasoning_content?: string | null;
              refusal?: string | null;
            })
          | undefined;
        const content = message?.content;
        actualModelId = response.model ?? actualModelId;
        providerRequestId = response.id;
        inputTokens = response.usage?.prompt_tokens ?? 0;
        outputTokens = response.usage?.completion_tokens ?? 0;
        choiceCount = response.choices.length;
        finishReason = choice?.finish_reason ?? null;
        contentState =
          content === null
            ? "null"
            : content === undefined
              ? "missing"
              : content.length === 0
                ? "empty"
                : "present";
        contentLength = content?.length ?? 0;
        reasoningContentPresent = Boolean(message?.reasoning_content);
        refusalPresent = Boolean(message?.refusal);
        toolCallCount = message?.tool_calls?.length ?? 0;
        deepSeekContent = content ?? undefined;
      }

      const responseReceivedAt = new Date().toISOString();
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
            response_received_at: responseReceivedAt,
            finish_reason: finishReason,
            choice_count: choiceCount,
            content_state: contentState,
            content_length: contentLength,
            reasoning_content_present: reasoningContentPresent,
            refusal_present: refusalPresent,
            tool_call_count: toolCallCount,
          },
          ["request_started"],
        );
      }
      if (contentState !== "present") {
        throw new DocumentModelOperationError(
          "The document model returned no structured output.",
          "empty_structured_output",
          input.operation,
        );
      }
      if (deepSeekContent !== undefined) {
        try {
          rawResponse = parseJsonObject(deepSeekContent);
        } catch (error) {
          if (error instanceof DocumentModelOperationError) {
            throw new DocumentModelOperationError(
              error.message,
              error.failureCategory,
              input.operation,
            );
          }
          throw error;
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
      const calculatedCostUsd = estimateModelCostUsd(actualModelId, {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
      });
      await this.onUsage?.({
        provider: this.profile.provider,
        requestedModelId: this.profile.requestedModelId,
        actualModelId,
        providerRequestId,
        operation: input.operation,
        componentKey: input.componentKey,
        inputFingerprint,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        calculatedCostUsd,
        durationMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      if (this.persistence) {
        const current = await this.getExecution(executionKey);
        if (
          current?.status === "running" ||
          current?.status === "request_started" ||
          current?.status === "response_received"
        ) {
          const knownFailure =
            error instanceof DocumentModelOperationError
              ? error.failureCategory
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
                error instanceof Error
                  ? error.message.slice(0, 2_000)
                  : String(error).slice(0, 2_000),
              lease_expires_at: null,
              completed_at: new Date().toISOString(),
            },
            [current.status],
          );
        }
      }
      throw error;
    }
  }

  private async getExecution(
    executionKey: string,
  ): Promise<StoredExecution | null> {
    if (!this.persistence) return null;
    const { data, error } = await this.persistence.supabase
      .from("document_v2_model_executions")
      .select("status,raw_response,lease_expires_at")
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
  }): Promise<T> {
    const parsed = input.schema.safeParse(input.rawResponse);
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
