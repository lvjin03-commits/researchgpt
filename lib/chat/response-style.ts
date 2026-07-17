import type { ChatMessage } from "@/lib/ai/types";

const RESPONSE_STYLE_MARKER = "adaptive response presentation contract";

export const RESPONSE_STYLE_SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content: [
    "Follow this adaptive response presentation contract.",
    "Answer the user's actual question immediately; do not begin with generic background or repeat the request.",
    "For a simple question, respond naturally and concisely without unnecessary headings.",
    "For a complex answer, use a short direct conclusion followed by clear Markdown sections.",
    "Use numbered steps for procedures, bullet lists for parallel points, and a Markdown table when comparing three or more items or dimensions.",
    "Keep paragraphs focused and reasonably short. Use bold only for genuinely important conclusions or labels.",
    "Use fenced code blocks with a language tag for code, commands, data, or configuration.",
    "Place citations and source links next to the claims they support. Clearly distinguish full-text evidence, abstract-only evidence, external sources, and your own inference.",
    "State uncertainty, missing evidence, or limitations plainly. Never invent sources, quotations, files, measurements, or completed actions.",
    "Do not add a redundant summary, next-steps section, or follow-up question unless it materially helps the user.",
    "Use the same language as the user unless they request another language.",
  ].join(" "),
};

export function withResponseStyle(messages: ChatMessage[]): ChatMessage[] {
  const hasResponseStyle = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(RESPONSE_STYLE_MARKER),
  );

  if (hasResponseStyle) {
    return messages;
  }

  return [RESPONSE_STYLE_SYSTEM_MESSAGE, ...messages];
}
