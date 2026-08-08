import type { GrantDocumentDraft } from "../domain/contracts.ts";

export const NSFC_DEFAULT_TEMPLATE = {
  templateKey: "nsfc-general-workspace",
  templateVersion: "1",
  rules: {
    language: "zh",
    maximumEstimatedPages: 30,
    charactersPerPage: 1100,
  },
} as const;

export function createNsfcDraft(title: string): GrantDocumentDraft {
  return {
    title,
    sections: [
      { localKey: "summary", semanticRole: "summary", title: "摘要", order: 0, nodes: [] },
      { localKey: "basis", semanticRole: "project_basis", title: "立项依据", order: 1, nodes: [] },
      { localKey: "objectives", semanticRole: "research_objectives", title: "研究目标", order: 2, nodes: [] },
      { localKey: "content", semanticRole: "research_content", title: "研究内容", order: 3, nodes: [] },
      { localKey: "route", semanticRole: "technical_route", title: "技术路线", order: 4, nodes: [] },
      { localKey: "innovation", semanticRole: "innovation", title: "创新点", order: 5, nodes: [] },
    ],
  };
}
