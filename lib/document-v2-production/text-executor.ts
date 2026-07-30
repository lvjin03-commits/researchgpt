import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z, type ZodType } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { estimateModelCostUsd } from "@/lib/ai/cost";
import type { DocumentTextExecutionProfile } from "@/lib/document-v2/runtime/contracts";

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

type StoredExecution = {
  status: "running" | "succeeded" | "failed";
  raw_response: unknown;
};

function fingerprint(input: {
  profile: DocumentTextExecutionProfile;
  operation: string;
  componentKey?: string;
  schemaName: string;
  systemInstruction: string;
  userInstruction: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
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
    const executionKey = createHash("sha256")
      .update(
        [
          this.persistence?.jobId ?? "unpersisted",
          input.componentKey ?? "document",
          input.operation,
          inputFingerprint,
        ].join(":"),
      )
      .digest("hex");
    if (this.persistence) {
      const existing = await this.getExecution(executionKey);
      if (existing?.status === "succeeded") {
        return input.schema.parse(existing.raw_response);
      }
      if (existing?.status === "running") {
        throw new DocumentModelExecutionInProgressError(executionKey);
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
        });
      if (error) {
        const raced = await this.getExecution(executionKey);
        if (raced?.status === "succeeded") {
          return input.schema.parse(raced.raw_response);
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
        await this.persistence.supabase
          .from("document_v2_model_executions")
          .update({
            status: "succeeded",
            raw_response: rawResponse,
            actual_model_id: actualModelId,
            provider_request_id: providerRequestId ?? null,
            input_tokens: inputTokens,
            cached_input_tokens: cachedInputTokens,
            output_tokens: outputTokens,
            reasoning_tokens: reasoningTokens,
            completed_at: new Date().toISOString(),
          })
          .eq("execution_key", executionKey);
      }
      parsed = input.schema.parse(rawResponse);
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
        await this.persistence.supabase
          .from("document_v2_model_executions")
          .update({
            status: "failed",
            error_message:
              error instanceof Error
                ? error.message.slice(0, 2_000)
                : String(error).slice(0, 2_000),
            completed_at: new Date().toISOString(),
          })
          .eq("execution_key", executionKey)
          .eq("status", "running");
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
      .select("status,raw_response")
      .eq("execution_key", executionKey)
      .maybeSingle();
    if (error) throw error;
    return data as StoredExecution | null;
  }
}
