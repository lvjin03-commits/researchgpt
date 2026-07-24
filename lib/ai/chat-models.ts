export const CHAT_MODEL_TIERS = [
  "economy",
  "standard",
  "professional",
  "flagship",
] as const;

export type ChatModelTier = (typeof CHAT_MODEL_TIERS)[number];

export const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "economy";

export type ChatModelProvider = "deepseek" | "openai";

export type ChatModelOption = {
  tier: ChatModelTier;
  label: string;
  description: string;
  model: string;
  provider: ChatModelProvider;
  reasoningEffort: "none" | "low" | "medium";
  maxOutputTokens: number;
  maxVisuals: number;
  expensive?: boolean;
  costWarning?: string;
};

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    tier: "economy",
    label: "ResearchGPT Nano",
    description: "经济型，适合日常问答、摘要和简单整理。",
    model: "deepseek-v4-flash",
    provider: "deepseek",
    reasoningEffort: "none",
    maxOutputTokens: 1600,
    maxVisuals: 1,
  },
  {
    tier: "standard",
    label: "ResearchGPT Mini",
    description: "标准型，适合较复杂分析和 1-3 张专业图表。",
    model: "deepseek-v4-pro",
    provider: "deepseek",
    reasoningEffort: "low",
    maxOutputTokens: 3000,
    maxVisuals: 3,
  },
  {
    tier: "professional",
    label: "ResearchGPT Pro",
    description: "专业型，调用当前可用的 GPT 专业模型，适合高质量科研分析。",
    model: "gpt-5.4",
    provider: "openai",
    reasoningEffort: "medium",
    maxOutputTokens: 5000,
    maxVisuals: 6,
    expensive: true,
    costWarning:
      "专业型将调用 GPT 专业模型，适合高质量科研分析，token 成本高于经济/标准模型。确认继续使用吗？",
  },
  {
    tier: "flagship",
    label: "ResearchGPT Ultra",
    description: "旗舰型，调用 GPT5.6SOL，适合最复杂任务。",
    model: "gpt-5.6-sol",
    provider: "openai",
    reasoningEffort: "medium",
    maxOutputTokens: 7000,
    maxVisuals: 8,
    expensive: true,
    costWarning:
      "旗舰型将调用 GPT5.6SOL，适合最复杂任务，但 token 成本最高。确认继续使用吗？",
  },
] as const;

export function isChatModelTier(value: unknown): value is ChatModelTier {
  return CHAT_MODEL_TIERS.includes(value as ChatModelTier);
}

export function getChatModelOption(tier: ChatModelTier): ChatModelOption {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.tier === tier) ??
    CHAT_MODEL_OPTIONS[0]
  );
}
