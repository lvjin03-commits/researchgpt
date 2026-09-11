import OpenAI from "openai";
import { z } from "zod";
import type {
  GrantGeneralWebSearchProvider,
  GrantGeneralWebSearchProviderResult,
} from "../../ports/grant-general-web-search-provider.ts";
import { GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION } from "../../web-sources/query-egress-policy.ts";

const UrlCitationSchema = z.object({
  type: z.literal("url_citation"),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(3000),
}).passthrough();

const OutputTextSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
  annotations: z.array(z.unknown()),
}).passthrough();

const MessageOutputSchema = z.object({
  type: z.literal("message"),
  content: z.array(z.unknown()),
}).passthrough();

const WebSearchCallOutputSchema = z.object({
  type: z.literal("web_search_call"),
}).passthrough();

const ResponseUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({
    cached_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
  output_tokens: z.number().int().nonnegative(),
  output_tokens_details: z.object({
    reasoning_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

const OpenAIWebSearchResponseSchema = z.object({
  id: z.string().trim().min(1).max(500),
  output: z.array(z.unknown()),
  usage: ResponseUsageSchema,
}).passthrough();

type OpenAIWebSearchClient = {
  responses: { create(input: unknown): Promise<unknown> };
};

export type GrantOpenAIWebSearchFailureCategory =
  | "configuration_invalid" | "egress_not_approved" | "rate_limited"
  | "provider_rejected" | "provider_unavailable" | "response_invalid";

export class GrantOpenAIWebSearchError extends Error {
  readonly category: GrantOpenAIWebSearchFailureCategory;
  constructor(category: GrantOpenAIWebSearchFailureCategory, message: string) {
    super(message);
    this.category = category;
    this.name = "GrantOpenAIWebSearchError";
  }
}

function boundedCitationContext(text: string, start: number, end: number): string {
  const safeStart = Math.min(Math.max(start, 0), text.length);
  const safeEnd = Math.min(Math.max(end, safeStart), text.length);
  const before = text.lastIndexOf("\n", Math.max(0, safeStart - 600));
  const after = text.indexOf("\n", Math.min(text.length, safeEnd + 600));
  const from = Math.max(before >= 0 ? before + 1 : 0, safeStart - 500);
  const to = Math.min(after >= 0 ? after : text.length, safeEnd + 500);
  return text.slice(from, to).replace(/\s+/gu, " ").trim().slice(0, 1200);
}

export class OpenAIWebSearchProvider implements GrantGeneralWebSearchProvider {
  readonly providerId = "openai_web_search" as const;
  private readonly client: OpenAIWebSearchClient;
  private readonly modelId: string;

  constructor(input: { apiKey: string; modelId: string; client?: OpenAIWebSearchClient }) {
    this.modelId = input.modelId.trim();
    if ((!input.apiKey.trim() && !input.client) || !this.modelId) {
      throw new GrantOpenAIWebSearchError("configuration_invalid", "OpenAI web search configuration is incomplete.");
    }
    this.client = input.client ?? (new OpenAI({ apiKey: input.apiKey }) as unknown as OpenAIWebSearchClient);
  }

  async search(input: Parameters<GrantGeneralWebSearchProvider["search"]>[0]) {
    if (!input.approvedQuery.allowed || input.approvedQuery.policyVersion !== GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION) {
      throw new GrantOpenAIWebSearchError("egress_not_approved", "Search query has not passed the current egress policy.");
    }
    if (!Number.isInteger(input.maximumResults) || input.maximumResults < 1 || input.maximumResults > 10) {
      throw new GrantOpenAIWebSearchError("configuration_invalid", "OpenAI result limit must be between 1 and 10.");
    }

    let raw: unknown;
    try {
      raw = await this.client.responses.create({
        model: this.modelId,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "system",
            content: "Search the public web for the supplied generalized research query. Return a concise factual research brief. Cite every factual statement with the web source that supports it. Do not infer or reproduce private application content.",
          },
          { role: "user", content: input.approvedQuery.outgoingQuery },
        ],
      });
    } catch (error) {
      if (error instanceof OpenAI.RateLimitError) {
        throw new GrantOpenAIWebSearchError("rate_limited", "OpenAI web search quota is temporarily exhausted.");
      }
      if (error instanceof OpenAI.APIError) {
        if (error.status === 400 || error.status === 401 || error.status === 403) {
          throw new GrantOpenAIWebSearchError("provider_rejected", "OpenAI rejected the web search request.");
        }
        throw new GrantOpenAIWebSearchError("provider_unavailable", "OpenAI web search is temporarily unavailable.");
      }
      throw new GrantOpenAIWebSearchError("provider_unavailable", "OpenAI web search is temporarily unavailable.");
    }

    const parsed = OpenAIWebSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GrantOpenAIWebSearchError("response_invalid", "OpenAI web search response did not match the expected contract.");
    }

    const webSearchCalls = parsed.data.output.filter((item) => WebSearchCallOutputSchema.safeParse(item).success).length;
    if (webSearchCalls < 1) {
      throw new GrantOpenAIWebSearchError("response_invalid", "OpenAI web search response reported no search tool call.");
    }
    const seen = new Set<string>();
    const results: GrantGeneralWebSearchProviderResult[] = [];
    for (const rawItem of parsed.data.output) {
      const item = MessageOutputSchema.safeParse(rawItem);
      if (!item.success) continue;
      for (const rawContent of item.data.content) {
        const content = OutputTextSchema.safeParse(rawContent);
        if (!content.success) continue;
        for (const rawAnnotation of content.data.annotations) {
          const annotation = UrlCitationSchema.safeParse(rawAnnotation);
          if (!annotation.success) continue;
          if (results.length >= input.maximumResults) continue;
          const url = annotation.data.url;
          if (seen.has(url)) continue;
          const snippet = boundedCitationContext(content.data.text, annotation.data.start_index, annotation.data.end_index);
          if (!snippet) continue;
          seen.add(url);
          results.push({
            providerId: this.providerId,
            providerRecordId: `${parsed.data.id}:${results.length + 1}`,
            title: annotation.data.title,
            url,
            snippet,
            publishedAt: null,
          });
        }
      }
    }
    return {
      results,
      usage: {
        providerRequestId: parsed.data.id,
        webSearchCalls,
        inputTokens: parsed.data.usage.input_tokens,
        cachedInputTokens: parsed.data.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: parsed.data.usage.output_tokens,
        reasoningTokens: parsed.data.usage.output_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }
}
