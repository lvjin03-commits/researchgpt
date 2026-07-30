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

type StoredExecution = {
  status:
    | "running"
    | "request_started"
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
    if (start < 0 || end <= start) throw new Error("The model returned no JSON object.");
    return JSON.parse(trimmed.slice(start, end + 1));
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
        if (!response.output_parsed) {
          throw new Error("The document model returned no structured output.");
        }
        rawResponse = response.output_parsed;
        actualModelId = response.model ?? actualModelId;
        providerRequestId = response.id;
        inputTokens = response.usage?.input_tokens ?? 0;
        cachedInputTokens =
          response.usage?.input_tokens_details?.cached_tokens ?? 0;
        outputTokens = response.usage?.output_tokens ?? 0;
        reasoningTokens =
          response.usage?.output_tokens_details?.reasoning_tokens ?? 0;
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
        const content = response.choices[0]?.message.content;
        if (!content) {
          throw new Error("The document model returned no structured output.");
        }
        rawResponse = parseJsonObject(content);
        actualModelId = response.model ?? actualModelId;
        providerRequestId = response.id;
        inputTokens = response.usage?.prompt_tokens ?? 0;
        outputTokens = response.usage?.completion_tokens ?? 0;
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
            response_received_at: new Date().toISOString(),
            raw_saved_at: new Date().toISOString(),
            lease_expires_at: null,
          },
          ["request_started"],
        );
      }
      const validation = input.schema.safeParse(rawResponse);
      if (!validation.success) {
        if (this.persistence) {
          await this.mustUpdateExecution(
            executionKey,
            {
              status: "validation_failed",
              failure_category: "schema_validation",
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
          current?.status === "request_started"
        ) {
          await this.mustUpdateExecution(
            executionKey,
            {
              status:
                current.status === "request_started"
                  ? "unknown_outcome"
                  : "failed",
              failure_category:
                current.status === "request_started"
                  ? "provider_outcome_unknown"
                  : "pre_provider_failure",
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
          failure_category: "schema_validation",
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
