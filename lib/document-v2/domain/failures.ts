export type DocumentFailureCategory =
  | "domain"
  | "infrastructure"
  | "provider"
  | "unknown_outcome";

export type DocumentFailureRetryability = "none" | "safe" | "unknown";

export interface DocumentFailureCause {
  name?: string;
  message?: string;
  providerCode?: string;
  stackHash?: string;
}

export interface DocumentFailure {
  code: string;
  category: DocumentFailureCategory;
  diagnosticCategory?: string;
  operation: string;
  stage?: string;
  componentKey?: string;
  path?: string;
  details?: Record<string, unknown>;
  safeResumeFrom?: string;
  retryability: DocumentFailureRetryability;
  userMessageCode: string;
  technicalMessage: string;
  cause?: DocumentFailureCause;
}

export class DocumentFailureError extends Error {
  constructor(readonly failure: DocumentFailure) {
    super(failure.technicalMessage);
    this.name = "DocumentFailureError";
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

export function infrastructureFailure(input: {
  error: unknown;
  code?: string;
  operation: string;
  stage?: string;
  componentKey?: string;
  safeResumeFrom?: string;
  retryability?: DocumentFailureRetryability;
  userMessageCode?: string;
}): DocumentFailure {
  const technicalMessage =
    input.error instanceof Error ? input.error.message : String(input.error);
  return {
    code: input.code ?? "document_infrastructure_failed",
    category: "infrastructure",
    diagnosticCategory: "worker_failure",
    operation: input.operation,
    stage: input.stage,
    componentKey: input.componentKey,
    safeResumeFrom: input.safeResumeFrom,
    retryability: input.retryability ?? "safe",
    userMessageCode:
      input.userMessageCode ?? "document.execution_temporarily_failed",
    technicalMessage,
    cause: {
      name: input.error instanceof Error ? input.error.name : undefined,
      message: technicalMessage,
      providerCode: errorCode(input.error),
    },
  };
}

export function documentFailureFromUnknown(input: {
  error: unknown;
  operation: string;
  stage?: string;
  componentKey?: string;
}): DocumentFailure {
  if (input.error instanceof DocumentFailureError) {
    return input.error.failure;
  }
  return infrastructureFailure({
    error: input.error,
    code: "document_worker_failed",
    operation: input.operation,
    stage: input.stage,
    componentKey: input.componentKey,
    userMessageCode: "document.execution_failed",
  });
}

export function documentFailureUserMessage(code: string): string {
  if (code === "document.worker_paused") {
    return "文档生成在当前阶段暂停，请查看运行详情后重试。";
  }
  if (code === "document.figure_quality_failed") {
    return "图片生成未通过质量检查。";
  }
  if (code === "document.content_quality_failed") {
    return "当前部分的内容未通过质量检查。";
  }
  if (code === "document.render_failed") {
    return "Word 文档排版失败。";
  }
  if (code === "document.provider_timeout") {
    return "模型响应超时，当前进度已保存，请稍后继续。";
  }
  if (code === "document.provider_unavailable") {
    return "模型服务暂时不可用，当前进度已保存，请稍后继续。";
  }
  if (code === "document.execution_temporarily_failed") {
    return "后台执行暂时失败，当前进度已保存，系统可以继续恢复。";
  }
  return "文档生成在当前阶段停止，请查看详情后重试。";
}

export function documentFailureUserMessageForCode(code: string): string {
  if (code.includes("timeout")) {
    return documentFailureUserMessage("document.provider_timeout");
  }
  if (code.includes("unavailable")) {
    return documentFailureUserMessage("document.provider_unavailable");
  }
  if (code.includes("figure_asset")) {
    return documentFailureUserMessage("document.figure_quality_failed");
  }
  if (code.includes("validation") || code.includes("structure")) {
    return documentFailureUserMessage("document.content_quality_failed");
  }
  if (code.includes("render")) {
    return documentFailureUserMessage("document.render_failed");
  }
  return documentFailureUserMessage("document.execution_failed");
}
