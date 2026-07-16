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
};

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    tier: "economy",
    label: "经济",
    description: "快速问答与日常处理",
    model: "gpt-5.4-mini",
    reasoningEffort: "none",
    maxOutputTokens: 1800,
  },
  {
    tier: "standard",
    label: "标准",
    description: "科研讨论与论文解释",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    maxOutputTokens: 4000,
  },
  {
    tier: "advanced",
    label: "深度",
    description: "复杂分析与高质量推理",
    model: "gpt-5.6",
    reasoningEffort: "medium",
    maxOutputTokens: 7000,
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
