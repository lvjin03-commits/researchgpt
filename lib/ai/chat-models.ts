export const CHAT_MODEL_TIERS = ["economy", "standard", "advanced"] as const;

export type ChatModelTier = (typeof CHAT_MODEL_TIERS)[number];

export const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "standard";

export type ChatModelOption = {
  tier: ChatModelTier;
  label: string;
  description: string;
  model: string;
  reasoningEffort: "none" | "low" | "medium";
  maxOutputTokens: number;
  maxVisuals: number;
};

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    tier: "economy",
    label: "经济",
    description: "快速问答，按需最多 1 张程序图",
    model: "gpt-5.4-mini",
    reasoningEffort: "none",
    maxOutputTokens: 1800,
    maxVisuals: 1,
  },
  {
    tier: "standard",
    label: "标准",
    description: "科研分析，按需生成 1–3 张专业图表",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    maxOutputTokens: 4000,
    maxVisuals: 3,
  },
  {
    tier: "advanced",
    label: "深度",
    description: "全文证据分析，按需最多 6 张证据图表",
    model: "gpt-5.6",
    reasoningEffort: "medium",
    maxOutputTokens: 7000,
    maxVisuals: 6,
  },
] as const;

export function isChatModelTier(value: unknown): value is ChatModelTier {
  return CHAT_MODEL_TIERS.includes(value as ChatModelTier);
}

export function getChatModelOption(tier: ChatModelTier): ChatModelOption {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.tier === tier) ??
    CHAT_MODEL_OPTIONS[1]
  );
}
