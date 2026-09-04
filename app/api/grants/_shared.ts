import { ZodError } from "zod";
import {
  GrantDocumentNotFoundError,
  GrantRevisionConflictError,
} from "@/lib/grants/application/revision-service";
import {
  GrantAuthenticationRequiredError,
  GrantAiPatchDisabledError,
  GrantAiEditSessionDisabledError,
  GrantAssistantChatDisabledError,
  GrantEvidencePatchDisabledError,
  GrantLocalEvidenceDisabledError,
  GrantWorkspaceDisabledError,
  GrantRecheckDisabledError,
  GrantDocxExportDisabledError,
} from "@/lib/grants/server/request-context";
import { GrantDocxImportError } from "@/lib/grants/imports/docx-importer";
import { GrantImportStorageError } from "@/lib/grants/ports/grant-import-storage";
import { GrantPatchNotFoundError, GrantPatchStateError } from "@/lib/grants/application/patch-service";
import { GrantEvidenceProviderPolicyError, GrantPatchEvidenceMismatchError } from "@/lib/grants/application/grant-model-data-gateway";
import { GrantPatchPolicyError } from "@/lib/grants/patching/patch-policy";
import {
  GrantEvidenceAuthorizationConflictError,
  GrantEvidenceNotFoundError,
  GrantEvidenceUseDeniedError,
} from "@/lib/grants/application/evidence-authorization-service";
import { GrantEvidenceStorageError } from "@/lib/grants/ports/grant-evidence-storage";
import { GrantEvidenceUploadError } from "@/lib/grants/server/read-evidence-upload";
import { UploadError } from "@/lib/uploads/errors";
import {
  GrantFigureAuthorizationConflictError,
  GrantFigureAuthorizationDeniedError,
} from "@/lib/grants/application/figure-model-authorization-service";
import { GrantAiEditSessionError } from "@/lib/grants/application/grant-ai-edit-session-service";
import { GrantWebSourceError } from "@/lib/grants/application/grant-web-source-service";
import { GrantAssistantChatError } from "@/lib/grants/application/grant-assistant-chat-service";
import { GrantCandidateDiffError } from "@/lib/grants/application/grant-candidate-diff-service";
import { GrantModelExecutionError } from "@/lib/grants/application/grant-model-executor";

export function grantApiError(error: unknown, operation: string): Response {
  if (error instanceof GrantWorkspaceDisabledError) {
    return Response.json({ error: "国自然协作工作台尚未开放。", code: "grant_workspace_disabled" }, { status: 404 });
  }
  if (error instanceof GrantAuthenticationRequiredError) {
    return Response.json({ error: "请先登录。", code: "authentication_required" }, { status: 401 });
  }
  if (error instanceof GrantAiPatchDisabledError) {
    return Response.json({ error: "AI 局部修改功能尚未开放。", code: "grant_ai_patch_disabled" }, { status: 404 });
  }
  if (error instanceof GrantAiEditSessionDisabledError) {
    return Response.json({ error: "AI 多轮修改功能尚未开放。", code: "grant_ai_edit_session_disabled" }, { status: 404 });
  }
  if (error instanceof GrantAssistantChatDisabledError) {
    return Response.json({ error: "Grant AI 普通对话功能尚未开放。", code: "grant_assistant_chat_disabled" }, { status: 404 });
  }
  if (error instanceof GrantCandidateDiffError) {
    const status = error.code.endsWith("_not_found") ? 404 : error.code.includes("invalid") ? 409 : 400;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof GrantAssistantChatError) {
    return Response.json({ error: error.message, code: error.code, focusChoices: error.focusChoices }, { status: error.code === "grant_assistant_duplicate_turn" ? 409 : 400 });
  }
  if (error instanceof GrantModelExecutionError) {
    const message = error.category === "provider_rate_limited"
      ? "当前 AI 请求较多，请稍后重试。"
      : error.category === "provider_contract_error" || error.category === "structured_output_invalid"
        ? "这次回答格式没有成功生成，请重新发送问题。"
        : "AI 服务暂时不可用，请稍后重试。";
    return Response.json({ error: message, code: "grant_model_retryable_error", traceId: error.traceId }, { status: 503 });
  }
  if (error instanceof GrantAiEditSessionError) {
    const status = error.code.endsWith("_not_found") ? 404 : error.code.includes("stale") || error.code.includes("not_active") || error.code.includes("not_safe") || error.code.includes("needs_repair") ? 409 : 400;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof GrantWebSourceError) {
    const status = error.code.endsWith("_not_found") ? 404 : error.code.includes("expired") || error.code.includes("closed") ? 409 : 400;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof GrantLocalEvidenceDisabledError) {
    return Response.json({ error: "项目资料功能尚未开放。", code: "grant_local_evidence_disabled" }, { status: 404 });
  }
  if (error instanceof GrantEvidencePatchDisabledError) {
    return Response.json({ error: "证据支持的 AI 修改功能尚未开放。", code: "grant_evidence_patch_disabled" }, { status: 404 });
  }
  if (error instanceof GrantRecheckDisabledError) {
    return Response.json({ error: "增量复检功能尚未开放。", code: "grant_recheck_disabled" }, { status: 404 });
  }
  if (error instanceof GrantDocxExportDisabledError) {
    return Response.json({ error: "Word 导出功能尚未开放。", code: "grant_docx_export_disabled" }, { status: 404 });
  }
  if (error instanceof GrantEvidenceNotFoundError) {
    return Response.json({ error: error.message, code: "grant_evidence_not_found" }, { status: 404 });
  }
  if (error instanceof GrantEvidenceAuthorizationConflictError) {
    return Response.json({ error: error.message, code: "grant_evidence_authorization_conflict" }, { status: 409 });
  }
  if (error instanceof GrantFigureAuthorizationConflictError) {
    return Response.json({ error: error.message, code: "grant_figure_authorization_conflict" }, { status: 409 });
  }
  if (error instanceof GrantFigureAuthorizationDeniedError) {
    return Response.json({ error: error.message, code: "grant_figure_authorization_denied" }, { status: 403 });
  }
  if (error instanceof GrantEvidenceUseDeniedError) {
    return Response.json({ error: error.message, code: "grant_evidence_use_denied", sourceId: error.sourceId }, { status: 403 });
  }
  if (error instanceof GrantEvidenceUploadError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof UploadError) {
    return Response.json({ error: error.message, code: "grant_evidence_parse_failed" }, { status: error.statusCode ?? 422 });
  }
  if (error instanceof GrantEvidenceStorageError) {
    console.error("[grant-api] Evidence storage failed", { operation, code: error.code });
    return Response.json({ error: error.message, code: error.code }, { status: 503 });
  }
  if (error instanceof GrantDocumentNotFoundError) {
    return Response.json({ error: "申请书不存在或无权访问。", code: "grant_document_not_found" }, { status: 404 });
  }
  if (error instanceof GrantPatchNotFoundError) {
    return Response.json({ error: error.message, code: "grant_patch_not_found" }, { status: 404 });
  }
  if (error instanceof GrantPatchStateError) {
    return Response.json({ error: error.message, code: "grant_patch_state_invalid" }, { status: 409 });
  }
  if (error instanceof GrantEvidenceProviderPolicyError) {
    return Response.json({ error: error.message, code: "grant_evidence_provider_policy_denied" }, { status: 403 });
  }
  if (error instanceof GrantPatchEvidenceMismatchError) {
    return Response.json({ error: error.message, code: "grant_patch_evidence_mismatch" }, { status: 409 });
  }
  if (error instanceof GrantPatchPolicyError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.code === "grant_patch_stale" ? 409 : 400 });
  }
  if (error instanceof GrantRevisionConflictError) {
    return Response.json({
      error: "文档已在其他位置更新，请加载最新版本后继续。",
      code: "grant_revision_conflict",
      currentRevisionId: error.currentRevisionId,
    }, { status: 409 });
  }
  if (error instanceof GrantDocxImportError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof GrantImportStorageError) {
    console.error("[grant-api] Grant import storage failed", {
      operation,
      code: error.code,
      providerErrorType: error.cause instanceof Error ? error.cause.name : typeof error.cause,
    });
    return Response.json({
      error: "原始申请书保存失败，尚未创建项目，请重试。",
      code: error.code,
    }, { status: error.code === "grant_original_storage_failed" ? 503 : 500 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "请求中的文档结构不合法。", code: "invalid_grant_request", issues: error.issues }, { status: 400 });
  }
  console.error("[grant-api]", { operation, error });
  return Response.json({ error: "申请书服务暂时不可用。", code: "grant_service_unavailable" }, { status: 500 });
}
