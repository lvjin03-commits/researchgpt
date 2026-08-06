import {
  documentFailureFromUnknown,
  type DocumentFailure,
} from "@/lib/document-v2/domain/failures";
import { OutlineLanguageMismatchError } from "@/lib/document-v2/planning/planner";
import {
  DocumentModelExecutionRequiresReviewError,
  DocumentModelOperationError,
} from "./text-executor";
import {
  ResearchExplorationRequiredPlanningError,
} from "@/lib/research-exploration/required/contracts";

export function mapWorkerFailure(error: unknown): DocumentFailure {
  if (error instanceof ResearchExplorationRequiredPlanningError) {
    const resolution = error.resolution;
    const failureCode = resolution.failureCode ?? "exploration_pending";
    return {
      code: `research_${failureCode}`,
      category: "domain",
      diagnosticCategory: "research_exploration_required",
      operation: "research.exploration.required",
      stage: "planning",
      safeResumeFrom: "research.exploration.required",
      retryability: resolution.outcome === "waiting" ? "safe" : "none",
      userMessageCode: "document.worker_paused",
      technicalMessage: error.message,
      details: {
        executionId: resolution.executionId,
        executionStatus: resolution.executionStatus,
        outcome: resolution.outcome,
        nextCheckAt: resolution.nextCheckAt,
        failureCode,
      },
      cause: { name: error.name, message: error.message },
    };
  }
  if (error instanceof OutlineLanguageMismatchError) {
    return {
      code: error.failureCategory,
      category: "domain",
      diagnosticCategory: error.failureCategory,
      operation: error.sourceComponent,
      stage: "planning",
      safeResumeFrom: error.sourceComponent,
      retryability: "none",
      userMessageCode: "document.worker_paused",
      technicalMessage: JSON.stringify(error.diagnosticDetails()),
      details: error.diagnosticDetails(),
      cause: { name: error.name, message: error.message },
    };
  }
  if (error instanceof DocumentModelOperationError) {
    return {
      code: `document_model_${error.failureCategory}`,
      category: "provider",
      diagnosticCategory: error.failureCategory,
      operation: error.operation ?? "model.generate",
      retryability:
        error.failureCategory === "provider_empty_response" ||
        error.failureCategory === "provider_rate_limited" ||
        error.failureCategory === "provider_transient_error"
          ? "safe"
          : "none",
      userMessageCode: "document.worker_paused",
      technicalMessage: error.message,
      details: { failureCategory: error.failureCategory },
      cause: { name: error.name, message: error.message },
    };
  }
  if (error instanceof DocumentModelExecutionRequiresReviewError) {
    return {
      code: `document_model_${error.executionStatus}`,
      category: "unknown_outcome",
      diagnosticCategory: error.executionStatus,
      operation: "model.execution.review",
      retryability: "unknown",
      userMessageCode: "document.worker_paused",
      technicalMessage: error.message,
      details: { executionStatus: error.executionStatus },
      cause: { name: error.name, message: error.message },
    };
  }
  const failure = documentFailureFromUnknown({
    error,
    operation: "worker.tick",
  });
  return { ...failure, userMessageCode: "document.worker_paused" };
}
