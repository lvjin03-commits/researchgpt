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
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.5,
  },
  "gpt-5.5": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
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
