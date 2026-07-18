import type { ChatMessage } from "@/lib/ai/types";
import type { ChatModelOption } from "@/lib/ai/chat-models";

const VISUAL_POLICY_MARKER = "scientific visual evidence contract";

const VISUAL_SCHEMAS = [
  "Use a fenced `visual` JSON block for every rendered visual.",
  'Quantitative schema: {"type":"bar|line","title":"...","labels":["..."],"series":[{"name":"...","values":[1,2]}],"xAxis":"...","yAxis":"...","unit":"...","caption":"...","source":"...","evidenceType":"user_data|literature|ai_structure"}.',
  'Fishbone schema: {"type":"fishbone","title":"...","problem":"...","branches":[{"name":"人员","causes":["..."]}],"caption":"...","source":"...","evidenceType":"ai_structure"}.',
  'Process schema: {"type":"process","title":"...","steps":[{"title":"...","description":"..."}],"caption":"...","source":"...","evidenceType":"ai_structure"}.',
  'Timeline schema: {"type":"timeline","title":"...","events":[{"label":"2024","title":"...","description":"..."}],"caption":"...","source":"...","evidenceType":"literature|ai_structure"}.',
].join("\n");

function tierInstruction(option: ChatModelOption): string {
  if (option.tier === "economy") {
    return [
      "Economy visual budget: render at most 1 visual.",
      "Only render it when it materially improves comprehension.",
      "Prefer a locally rendered structure diagram or a simple verified data chart.",
      "Do not request or imply AI-generated illustrative imagery.",
    ].join(" ");
  }

  if (option.tier === "standard") {
    return [
      "Standard visual budget: render 1 to 3 visuals when the task benefits from them; zero is allowed when evidence is insufficient.",
      "Prioritize one overview structure diagram and the strongest verified result chart.",
      "Avoid decorative visuals and redundant charts.",
    ].join(" ");
  }

  return [
    `Advanced visual budget: render up to ${option.maxVisuals} visuals when they each support a distinct scientific claim; never fill the quota mechanically.`,
    "Build an evidence-led visual sequence such as research question, method/process, key result, comparison, mechanism, and limitation.",
    "Prefer verified literature or user data and clearly mark conceptual synthesis.",
  ].join(" ");
}

export function withScientificVisualPolicy(
  messages: ChatMessage[],
  option: ChatModelOption,
): ChatMessage[] {
  const hasPolicy = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(VISUAL_POLICY_MARKER),
  );

  if (hasPolicy) {
    return messages;
  }

  const instruction: ChatMessage = {
    role: "system",
    content: [
      `Follow this ${VISUAL_POLICY_MARKER}.`,
      tierInstruction(option),
      "A visual must explain evidence or structure, not merely decorate the answer.",
      "Never invent numeric values. If numeric evidence is unavailable, use a qualitative structure diagram instead of a quantitative chart.",
      "Every visual must include a concise caption, a source statement, and an evidenceType.",
      "Use evidenceType=ai_structure for an AI-organized conceptual diagram and explicitly say it is not raw experimental evidence.",
      "Keep labels concise, use the user's language, and explain the scientific takeaway immediately after each visual.",
      "Do not use ASCII art, Mermaid, or a generic code block when a supported visual schema applies.",
      VISUAL_SCHEMAS,
    ].join("\n"),
  };

  return [instruction, ...messages];
}
