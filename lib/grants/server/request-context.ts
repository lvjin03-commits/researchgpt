import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createGrantEditorService } from "./composition.ts";
import { createGrantDiagnosticService } from "./composition.ts";
import { createGrantFeedbackService } from "./composition.ts";
import { createGrantDocxImportService } from "./composition.ts";
import { createGrantPatchService } from "./composition.ts";
import { createGrantEvidenceService } from "./composition.ts";
import { createGrantExportService } from "./composition.ts";
import { createGrantFigureModelAuthorizationService } from "./composition.ts";
import { createGrantAiEditSessionService } from "./composition.ts";
import { createGrantWebSourceService } from "./composition.ts";
import { createGrantAssistantChatService } from "./composition.ts";
import { isGrantAiEditSessionEnabled, isGrantAiPatchEnabled, isGrantAssistantChatEnabled, isGrantDocxExportEnabled, isGrantEvidencePatchEnabled, isGrantLocalEvidenceEnabled, isGrantRecheckEnabled, isGrantWorkspaceEnabled } from "./config.ts";

export class GrantWorkspaceDisabledError extends Error {}
export class GrantAuthenticationRequiredError extends Error {}
export class GrantAiPatchDisabledError extends Error {}
export class GrantAiEditSessionDisabledError extends Error {}
export class GrantAssistantChatDisabledError extends Error {}
export class GrantLocalEvidenceDisabledError extends Error {}
export class GrantEvidencePatchDisabledError extends Error {}
export class GrantRecheckDisabledError extends Error {}
export class GrantDocxExportDisabledError extends Error {}

export async function requireGrantRequestContext() {
  if (!isGrantWorkspaceEnabled()) throw new GrantWorkspaceDisabledError();
  const userClient = await createClient();
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new GrantAuthenticationRequiredError();
  return {
    user,
    editor: createGrantEditorService(user.id),
    diagnostics: createGrantDiagnosticService(user.id),
    feedback: createGrantFeedbackService(user.id),
    docxImporter: createGrantDocxImportService(user.id),
    figureAuthorization: createGrantFigureModelAuthorizationService(user.id),
  };
}

export async function requireGrantAiPatchRequestContext() {
  if (!isGrantAiPatchEnabled()) throw new GrantAiPatchDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, patches: createGrantPatchService(context.user.id) };
}

export async function requireGrantAiEditSessionRequestContext() {
  if (!isGrantAiEditSessionEnabled()) throw new GrantAiEditSessionDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, editSessions: createGrantAiEditSessionService(context.user.id) };
}

export async function requireGrantAssistantChatRequestContext() {
  if (!isGrantAssistantChatEnabled()) throw new GrantAssistantChatDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, assistantChat: createGrantAssistantChatService(context.user.id) };
}

export async function requireGrantEvidenceRequestContext() {
  if (!isGrantLocalEvidenceEnabled()) throw new GrantLocalEvidenceDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, evidence: createGrantEvidenceService(context.user.id) };
}

export async function requireGrantWebSourceRequestContext() {
  if (!isGrantAiEditSessionEnabled() || !isGrantLocalEvidenceEnabled()) throw new GrantAiEditSessionDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, webSources: createGrantWebSourceService(context.user.id) };
}

export function requireGrantEvidencePatchEnabled(): void {
  if (!isGrantEvidencePatchEnabled() || !isGrantLocalEvidenceEnabled()) throw new GrantEvidencePatchDisabledError();
}

export async function requireGrantRecheckRequestContext() {
  if (!isGrantRecheckEnabled()) throw new GrantRecheckDisabledError();
  return requireGrantRequestContext();
}

export async function requireGrantDocxExportRequestContext() {
  if (!isGrantDocxExportEnabled()) throw new GrantDocxExportDisabledError();
  const context = await requireGrantRequestContext();
  return { ...context, exports: createGrantExportService(context.user.id) };
}
