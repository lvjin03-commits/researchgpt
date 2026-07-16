// Shared chat helper safe for /api/chat. Contains no document/export/PDF imports.

import type { ChatMessage } from "@/lib/ai/types";

const MODEL_IDENTITY_MARKER =
  "powered by the currently configured OpenAI model";

export function getConfiguredModelLabel(): string {
  return process.env.OPENAI_MODEL?.trim() || "default OpenAI model";
}

export function buildModelIdentitySystemMessage(
  selectedModel?: string,
): ChatMessage {
  const configuredModel = selectedModel?.trim() || getConfiguredModelLabel();

  return {
    role: "system",
    content: [
      "You are ResearchGPT, powered by the currently configured OpenAI model.",
      `Current configured model: ${configuredModel}.`,
      "If asked what model you are using, answer with the configured model name.",
      "Do not claim to be GPT-4 unless the configured model name is GPT-4.",
    ].join(" "),
  };
}

export function withModelIdentity(
  messages: ChatMessage[],
  selectedModel?: string,
): ChatMessage[] {
  const hasModelIdentity = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(MODEL_IDENTITY_MARKER),
  );

  if (hasModelIdentity) {
    return messages;
  }

  return [buildModelIdentitySystemMessage(selectedModel), ...messages];
}
