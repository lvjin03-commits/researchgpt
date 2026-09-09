import { notFound } from "next/navigation";
import { GrantStructuredEditor } from "@/components/grants/grant-structured-editor";
import { isGrantAiEditSessionEnabled, isGrantAiPatchEnabled, isGrantAssistantChatEnabled, isGrantDocxExportEnabled, isGrantEvidencePatchEnabled, isGrantLocalEvidenceEnabled, isGrantRecheckEnabled, isGrantWebGroundingEnabled, isGrantWorkspaceEnabled } from "@/lib/grants/server/config";

export default async function GrantEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isGrantWorkspaceEnabled()) notFound();
  const { id } = await params;
  return <GrantStructuredEditor
    documentId={id}
    aiPatchEnabled={isGrantAiPatchEnabled()}
    aiEditSessionEnabled={isGrantAiEditSessionEnabled()}
    assistantChatEnabled={isGrantAssistantChatEnabled()}
    webGroundingEnabled={isGrantWebGroundingEnabled()}
    evidenceEnabled={isGrantLocalEvidenceEnabled()}
    evidencePatchEnabled={isGrantEvidencePatchEnabled()}
    recheckEnabled={isGrantRecheckEnabled()}
    docxExportEnabled={isGrantDocxExportEnabled()}
  />;
}
