"use client";

import { LITERATURE_PROVIDER_BADGE_LABELS } from "@/lib/literature/paper-providers";
import {
  formatLiteratureDedupeMatchLabel,
  type LiteraturePaperSearchDebug,
  type LiteratureSearchDebug,
} from "@/lib/literature/search-debug";

function DebugDivider() {
  return <hr className="border-dashed border-violet-200" />;
}

function DebugRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-xs">
      <span className="font-medium text-violet-900">{label}</span>
      <span className="text-violet-800">{value}</span>
    </div>
  );
}

export function LiteratureSearchDebugSummary({
  summary,
}: {
  summary: LiteratureSearchDebug["summary"];
}) {
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/80 p-4 font-mono text-sm text-violet-950 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-violet-700">
        Search Summary
      </h2>

      <div className="space-y-1">
        <DebugRow label="OpenAlex:" value={summary.openalex} />
        <DebugRow label="PubMed:" value={summary.pubmed} />
        <DebugRow label="arXiv:" value={summary.arxiv} />
        <DebugRow label="Crossref:" value={summary.crossref} />
        <DebugRow label="DBLP:" value={summary.dblp} />
      </div>

      <div className="my-3">
        <DebugDivider />
      </div>

      <div className="space-y-1">
        <DebugRow label="Total fetched:" value={summary.totalFetched} />
        <DebugRow label="Duplicates removed:" value={summary.duplicatesRemoved} />
        <DebugRow label="Final papers:" value={summary.finalPapers} />
      </div>

      <div className="my-3">
        <DebugDivider />
      </div>
    </section>
  );
}

export function LiteraturePaperDebugPanel({
  paperDebug,
}: {
  paperDebug: LiteraturePaperSearchDebug;
}) {
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 font-mono text-xs text-violet-950">
      <div className="space-y-2">
        <DebugRow
          label="Providers:"
          value={paperDebug.providers
            .map((provider) => LITERATURE_PROVIDER_BADGE_LABELS[provider])
            .join(", ")}
        />
        <DebugRow
          label="Matched By:"
          value={formatLiteratureDedupeMatchLabel(
            paperDebug.matchedBy,
            paperDebug.mergeSourceCount,
          )}
        />
        <DebugRow
          label="Merge Source Count:"
          value={paperDebug.mergeSourceCount}
        />
        {typeof paperDebug.rankingScore === "number" && (
          <DebugRow label="Ranking Score:" value={paperDebug.rankingScore} />
        )}
      </div>
    </section>
  );
}
