import { notFound } from "next/navigation";
import { GrantDocumentList } from "@/components/grants/grant-document-list";
import { isGrantWorkspaceEnabled } from "@/lib/grants/server/config";

export default function GrantsPage() {
  if (!isGrantWorkspaceEnabled()) notFound();
  return <GrantDocumentList />;
}
