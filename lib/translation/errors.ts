export class TranslationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TranslationError";
    this.statusCode = statusCode;
  }
}
