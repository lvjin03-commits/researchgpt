import type { LiteraturePaperStatus, PaperWorkspaceDifficulty } from "@/lib/literature/types";

export const LITERATURE_PAPER_STATUS_LABELS: Record<LiteraturePaperStatus, string> = {
  new: "未处理",
  saved: "已收藏",
  read: "已读",
  skipped: "已忽略",
};

export const LITERATURE_DIFFICULTY_LABELS: Record<PaperWorkspaceDifficulty, string> = {
  Beginner: "入门",
  Intermediate: "中级",
  Advanced: "高级",
};

export function getPaperStatusLabel(status: LiteraturePaperStatus): string {
  return LITERATURE_PAPER_STATUS_LABELS[status];
}
