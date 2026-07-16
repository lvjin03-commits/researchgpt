import type { SupabaseClient } from "@supabase/supabase-js";
import { listLiteraturePapers } from "@/lib/literature/server/repository";

const MAX_PAPERS = 6;
const MAX_EXCERPT = 3200;

function termsFromQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ).slice(0, 20);
}

function scoreText(text: string, terms: string[]): number {
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => {
    const matches = normalized.split(term).length - 1;
    return score + Math.min(matches, 8);
  }, 0);
}

export async function buildLiteratureLibraryContext(
  supabase: SupabaseClient,
  userId: string,
  query: string,
): Promise<{ context: string; paperCount: number }> {
  const terms = termsFromQuery(query);
  const papers = await listLiteraturePapers(supabase, userId);

  const ranked = papers
    .map((paper) => ({
      paper,
      score: scoreText(
        `${paper.title}\n${paper.abstract}\n${paper.fullText ?? ""}`,
        terms,
      ),
    }))
    .filter(({ paper, score }) => score > 0 || terms.length === 0 || Boolean(paper.fullText))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_PAPERS);

  const context = ranked
    .map(({ paper }, index) => {
      const evidence = paper.fullText || paper.abstract || "未保存摘要或全文";
      return [
        `[文献库来源 ${index + 1}]`,
        `题目：${paper.title}`,
        `作者：${paper.authors.join(", ") || "未知"}`,
        `时间：${paper.publishedAt ?? "未知"}`,
        `文献ID：${paper.id}`,
        `来源链接：${paper.absUrl || paper.pdfUrl || "无"}`,
        `证据级别：${paper.fullText ? "PDF全文" : "摘要"}`,
        `相关内容：${evidence.slice(0, MAX_EXCERPT)}`,
      ].join("\n");
    })
    .join("\n\n");

  return { context, paperCount: ranked.length };
}
