export type NormalizedContentState =
  | "missing"
  | "null"
  | "empty"
  | "whitespace"
  | "present";

export type NormalizedAuxiliaryContent = {
  type: "reasoning" | "analysis" | "unknown";
  content: string;
};

export type NormalizedProviderResponse = {
  actualModelId?: string;
  providerRequestId?: string;
  content: string | null;
  contentState: NormalizedContentState;
  auxiliaryContent: NormalizedAuxiliaryContent[];
  parsedResponse?: unknown;
  finishReason: string | null;
  choiceCount: number;
  refusalPresent: boolean;
  toolCallCount: number;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
};

function contentState(value: unknown): NormalizedContentState {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value !== "string") return "missing";
  if (value.length === 0) return "empty";
  if (value.trim().length === 0) return "whitespace";
  return "present";
}

export function normalizeChatCompletionResponse(response: {
  id?: string | null;
  model?: string | null;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      refusal?: string | null;
      tool_calls?: unknown[] | null;
    } | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}): NormalizedProviderResponse {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const reasoning = message?.reasoning_content;
  return {
    actualModelId: response.model ?? undefined,
    providerRequestId: response.id ?? undefined,
    content: typeof content === "string" ? content : null,
    contentState: contentState(content),
    auxiliaryContent:
      typeof reasoning === "string" && reasoning.trim()
        ? [{ type: "reasoning", content: reasoning }]
        : [],
    finishReason: choice?.finish_reason ?? null,
    choiceCount: response.choices?.length ?? 0,
    refusalPresent: Boolean(message?.refusal),
    toolCallCount: message?.tool_calls?.length ?? 0,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      cachedInputTokens:
        response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      reasoningTokens:
        response.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

export function normalizeParsedResponse(response: {
  id?: string | null;
  model?: string | null;
  status?: string | null;
  output_parsed?: unknown;
  output?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}): NormalizedProviderResponse {
  const parsed = response.output_parsed;
  const content = parsed == null ? null : JSON.stringify(parsed);
  return {
    actualModelId: response.model ?? undefined,
    providerRequestId: response.id ?? undefined,
    content,
    contentState: contentState(content),
    auxiliaryContent: [],
    parsedResponse: parsed,
    finishReason: response.status ?? null,
    choiceCount: response.output?.length ?? 0,
    refusalPresent:
      response.output?.some((item) => {
        if (!item || typeof item !== "object" || !("content" in item)) {
          return false;
        }
        const content = (item as { content?: unknown }).content;
        return (
          Array.isArray(content) &&
          content.some(
            (entry) =>
              Boolean(entry) &&
              typeof entry === "object" &&
              "type" in entry &&
              entry.type === "refusal",
          )
        );
      }) ?? false,
    toolCallCount: 0,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      cachedInputTokens:
        response.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      reasoningTokens:
        response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}
