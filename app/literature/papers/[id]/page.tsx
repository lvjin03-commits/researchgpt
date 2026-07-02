import { LiteraturePaperDetailShell } from "@/components/literature-paper-detail-shell";

type LiteraturePaperDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function LiteraturePaperDetailPage({
  params,
}: LiteraturePaperDetailPageProps) {
  const { id } = await params;

  return <LiteraturePaperDetailShell paperId={id} />;
}
