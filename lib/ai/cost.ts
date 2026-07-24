export type AiTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type ModelPrice = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_PRICES: Record<string, ModelPrice> = {
  "deepseek-v4-flash": {
    inputPerMillion: 0.14,
    cachedInputPerMillion: 0.014,
    outputPerMillion: 0.28,
  },
  "deepseek-v4-pro": {
    inputPerMillion: 0.435,
    cachedInputPerMillion: 0.0435,
    outputPerMillion: 0.87,
  },
  "gpt-5.4": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  "gpt-5.5-nano": {
    inputPerMillion: 1,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 6,
  },
  "gpt-5.6": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  "gpt-5.6-sol": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
  },
  "gpt-5.6-luna": {
    inputPerMillion: 1,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 6,
  },
};

export function estimateModelCostUsd(
  model: string,
  usage: AiTokenUsage,
): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;

  const cachedInput = Math.min(
    Math.max(0, usage.cachedInputTokens),
    Math.max(0, usage.inputTokens),
  );
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput);

  return (
    (uncachedInput * price.inputPerMillion +
      cachedInput * price.cachedInputPerMillion +
      Math.max(0, usage.outputTokens) * price.outputPerMillion) /
    1_000_000
  );
}
