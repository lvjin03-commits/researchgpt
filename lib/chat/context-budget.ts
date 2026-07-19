import type { ChatMessage, MessageContent } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import type { ChatModelTier } from "@/lib/ai/chat-models";

const TOTAL_CHARACTER_BUDGET: Record<ChatModelTier, number> = {
  economy: 28_000,
  standard: 52_000,
  advanced: 84_000,
};

const MESSAGE_CHARACTER_BUDGET: Record<ChatModelTier, number> = {
  economy: 7_000,
  standard: 12_000,
  advanced: 18_000,
};

function truncateContent(content: MessageContent, limit: number): MessageContent {
  if (typeof content === "string") {
    if (content.length <= limit) return content;
    return `${content.slice(0, limit)}\n\n[Earlier attachment or message content was truncated to control AI cost.]`;
  }

  let remaining = limit;
  const retained: MessageContent = [];
  for (const part of content) {
    if (part.type === "image_url") {
      retained.push(part);
      continue;
    }
    if (remaining <= 0) continue;
    const text = part.text.slice(0, remaining);
    remaining -= text.length;
    retained.push({ ...part, text });
  }
  return retained;
}

export function applyChatContextBudget(
  messages: ChatMessage[],
  tier: ChatModelTier,
): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversation = messages.filter((message) => message.role !== "system");
  const totalBudget = TOTAL_CHARACTER_BUDGET[tier];
  const perMessageBudget = MESSAGE_CHARACTER_BUDGET[tier];
  const retained: ChatMessage[] = [];
  let used = 0;

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    const textLength = getTextFromMessageContent(message.content).length;
    const remaining = totalBudget - used;
    if (remaining <= 0) break;

    const limit = Math.min(perMessageBudget, remaining);
    retained.unshift({
      ...message,
      content: truncateContent(message.content, limit),
    });
    used += Math.min(textLength, limit);
  }

  if (retained.length < conversation.length) {
    systemMessages.push({
      role: "system",
      content:
        "Older conversation turns were omitted to control cost. Use the retained recent turns and explicit project context; do not invent details from omitted turns.",
    });
  }

  return [...systemMessages, ...retained];
}

export function insertContextBeforeLastUser(
  messages: ChatMessage[],
  context: ChatMessage,
): ChatMessage[] {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (lastUserIndex < 0) return [...messages, context];

  return [
    ...messages.slice(0, lastUserIndex),
    context,
    ...messages.slice(lastUserIndex),
  ];
}
