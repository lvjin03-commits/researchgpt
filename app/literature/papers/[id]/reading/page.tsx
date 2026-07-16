import { LiteraturePaperReadingShell } from "@/components/literature-paper-reading-shell";

type LiteraturePaperReadingPageProps = {
  params: Promise<{ id: string }>;
};

export default async function LiteraturePaperReadingPage({
  params,
}: LiteraturePaperReadingPageProps) {
  const { id } = await params;

  return <LiteraturePaperReadingShell paperId={id} />;
}
