import { ZodError } from "zod";
import {
  GrantDocumentNotFoundError,
  GrantRevisionConflictError,
} from "@/lib/grants/application/revision-service";
import {
  GrantAuthenticationRequiredError,
  GrantWorkspaceDisabledError,
} from "@/lib/grants/server/request-context";

export function grantApiError(error: unknown, operation: string): Response {
  if (error instanceof GrantWorkspaceDisabledError) {
    return Response.json({ error: "国自然协作工作台尚未开放。", code: "grant_workspace_disabled" }, { status: 404 });
  }
  if (error instanceof GrantAuthenticationRequiredError) {
    return Response.json({ error: "请先登录。", code: "authentication_required" }, { status: 401 });
  }
  if (error instanceof GrantDocumentNotFoundError) {
    return Response.json({ error: "申请书不存在或无权访问。", code: "grant_document_not_found" }, { status: 404 });
  }
  if (error instanceof GrantRevisionConflictError) {
    return Response.json({
      error: "文档已在其他位置更新，请加载最新版本后继续。",
      code: "grant_revision_conflict",
      currentRevisionId: error.currentRevisionId,
    }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "请求中的文档结构不合法。", code: "invalid_grant_request", issues: error.issues }, { status: 400 });
  }
  console.error("[grant-api]", { operation, error });
  return Response.json({ error: "申请书服务暂时不可用。", code: "grant_service_unavailable" }, { status: 500 });
}
