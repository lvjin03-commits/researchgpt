export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | {
      type: "sources";
      sources: Array<{ title: string; url: string }>;
    }
  | {
      type: "images";
      images: Array<{
        title: string;
        imageUrl: string;
        sourceUrl: string;
        sourceTitle: string;
      }>;
    }
  | {
      type: "generated_image";
      image: {
        title: string;
        imageUrl: string;
        downloadUrl: string;
        model: string;
      };
    }
  | { type: "error"; message: string; code?: string }
  | {
      type: "usage";
      model: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      webSearchCalls: number;
      codeInterpreterCalls: number;
      estimatedCostUsd: number;
    };

export function encodeChatStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}
