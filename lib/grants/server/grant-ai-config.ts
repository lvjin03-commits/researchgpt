export type GrantAiConfig = {
  provider: "openai";
  modelId: string;
  apiKey?: string;
};

export function resolveGrantAiConfig(): GrantAiConfig {
  return {
    provider: "openai",
    modelId: process.env.GRANT_AI_MODEL?.trim() || "gpt-5.5",
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  };
}
