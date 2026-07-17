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
  | { type: "error"; message: string; code?: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };

export function encodeChatStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}
