import type { PresentationTemplateId } from "@/lib/literature/review/types";

export type PresentationTemplate = {
  id: PresentationTemplateId;
  name: string;
  description: string;
  accent: string;
  previewImages: string[];
};

export const DEFAULT_PRESENTATION_TEMPLATE_ID: PresentationTemplateId =
  "teal-minimal";

export const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  {
    id: "teal-minimal",
    name: "青灰简约学术",
    description: "克制留白、青灰边框与清晰结构图，适合科研汇报和答辩。",
    accent: "#607f89",
    previewImages: [
      "/presentation-templates/teal-minimal/cover.png",
      "/presentation-templates/teal-minimal/structure.png",
      "/presentation-templates/teal-minimal/process.png",
      "/presentation-templates/teal-minimal/timeline.png",
    ],
  },
  {
    id: "research-modern",
    name: "现代蓝学术",
    description: "信息密度较高，突出结论、证据与可编辑数据图示。",
    accent: "#1768e5",
    previewImages: [],
  },
];

export function isPresentationTemplateId(
  value: unknown,
): value is PresentationTemplateId {
  return PRESENTATION_TEMPLATES.some((template) => template.id === value);
}
