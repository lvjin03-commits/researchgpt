import { notFound } from "next/navigation";
import { GrantStructuredEditor } from "@/components/grants/grant-structured-editor";
import { isGrantAiPatchEnabled, isGrantEvidencePatchEnabled, isGrantLocalEvidenceEnabled, isGrantWorkspaceEnabled } from "@/lib/grants/server/config";

export default async function GrantEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isGrantWorkspaceEnabled()) notFound();
  const { id } = await params;
  return <GrantStructuredEditor
    documentId={id}
    aiPatchEnabled={isGrantAiPatchEnabled()}
    evidenceEnabled={isGrantLocalEvidenceEnabled()}
    evidencePatchEnabled={isGrantEvidencePatchEnabled()}
  />;
}
