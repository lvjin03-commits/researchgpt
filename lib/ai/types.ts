export type ChatRole = "user" | "assistant" | "system";

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type MessageContentPart = TextContentPart | ImageContentPart;

export type MessageContent = string | MessageContentPart[];

export type ChatMessage = {
  role: ChatRole;
  content: MessageContent;
};

export type StreamChatOptions = {
  messages: ChatMessage[];
  signal?: AbortSignal;
};

export type AIProviderName = "openai" | "openrouter";

export interface AIProviderAdapter {
  readonly name: AIProviderName;
  streamChat(options: StreamChatOptions): AsyncGenerator<string, void, undefined>;
}

export function messageHasImageContent(message: ChatMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}

export function messagesIncludeImages(messages: ChatMessage[]): boolean {
  return messages.some(messageHasImageContent);
}

export function getTextFromMessageContent(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is TextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}
