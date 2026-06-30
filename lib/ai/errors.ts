export class AIProviderError extends Error {
  readonly statusCode: number;
  readonly provider?: string;

  constructor(
    message: string,
    options: { statusCode?: number; provider?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AIProviderError";
    this.statusCode = options.statusCode ?? 500;
    this.provider = options.provider;
  }
}
