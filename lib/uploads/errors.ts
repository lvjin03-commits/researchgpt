export class UploadError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "UploadError";
    this.statusCode = statusCode;
  }
}

export class AttachmentParseError extends Error {
  readonly statusCode: number;
  readonly fileName: string;
  readonly fileType: string;
  readonly stage: string;
  readonly details: string;

  constructor(options: {
    fileName: string;
    fileType: string;
    stage: string;
    details: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super("Attachment parsing failed");
    this.name = "AttachmentParseError";
    this.statusCode = options.statusCode ?? 422;
    this.fileName = options.fileName;
    this.fileType = options.fileType;
    this.stage = options.stage;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
