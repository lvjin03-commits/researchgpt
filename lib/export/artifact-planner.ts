import { buildArtifactSpec, type ArtifactSpec } from "@/lib/export/artifact-spec";
import type { ExportFormat } from "@/lib/export/types";

export type ArtifactTemplateId = "academic" | "modern" | "minimal";

export type ArtifactTemplate = {
  id: ArtifactTemplateId;
  name: string;
  description: string;
  accent: string;
  background: string;
};

export type ArtifactQualityIssue = {
  level: "warning" | "info";
  message: string;
  repair: string;
};

export type ArtifactPlan = {
  artifact: ArtifactSpec;
  estimatedUnits: number;
  unitLabel: string;
  issues: ArtifactQualityIssue[];
  score: number;
};

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  {
    id: "academic",
    name: "经典学术",
    description: "稳重清晰，强调证据、图表和规范层级。",
    accent: "#1768e5",
    background: "#ffffff",
  },
  {
    id: "modern",
    name: "现代研究",
    description: "高对比信息设计，适合项目汇报和成果展示。",
    accent: "#0f766e",
    background: "#f8fafc",
  },
  {
    id: "minimal",
    name: "简洁报告",
    description: "克制留白，适合打印、归档和快速阅读。",
    accent: "#475569",
    background: "#ffffff",
  },
];

function estimateUnits(format: ExportFormat, artifact: ArtifactSpec): number {
  const textLength = artifact.sections.reduce(
    (sum, section) =>
      sum +
      section.paragraphs.join("").length +
      section.bullets.join("").length,
    0,
  );
  if (format === "pptx") return Math.max(2, artifact.sections.length + 1);
  if (format === "xlsx") return Math.max(1, artifact.tables.length + 1);
  if (format === "png" || format === "svg") return 1;
  return Math.max(1, Math.ceil(textLength / 1800));
}

function getUnitLabel(format: ExportFormat): string {
  if (format === "pptx") return "页幻灯片";
  if (format === "xlsx") return "个工作表";
  if (format === "png" || format === "svg") return "张成果图";
  return "页";
}

function inspectArtifact(
  artifact: ArtifactSpec,
  format: ExportFormat,
): ArtifactQualityIssue[] {
  const issues: ArtifactQualityIssue[] = [];
  if (artifact.sections.length === 0) {
    issues.push({
      level: "warning",
      message: "回答缺少明确章节，文件层级可能不够清晰。",
      repair: "自动建立“核心结论”和“详细说明”层级。",
    });
  }

  const longSections = artifact.sections.filter(
    (section) =>
      section.paragraphs.join("").length + section.bullets.join("").length >
      1600,
  );
  if (longSections.length > 0) {
    issues.push({
      level: "warning",
      message: `${longSections.length} 个章节内容较密，可能发生拥挤。`,
      repair:
        format === "pptx"
          ? "自动拆分幻灯片并压缩每页要点。"
          : "自动规范空行和分页，保持标题层级。",
    });
  }

  if (
    (format === "pptx" || format === "png" || format === "svg") &&
    artifact.sections.some((section) =>
      section.bullets.some((item) => item.length > 90),
    )
  ) {
    issues.push({
      level: "warning",
      message: "存在不适合视觉页面的长要点。",
      repair: "保留结论，将长要点压缩为适合展示的长度。",
    });
  }

  if (artifact.tables.some((table) => table.headers.length > 8)) {
    issues.push({
      level: "warning",
      message: "存在超过 8 列的宽表格。",
      repair: "使用横向布局，并在 Excel 中拆分独立工作表。",
    });
  }

  if (artifact.tables.length === 0 && format === "xlsx") {
    issues.push({
      level: "info",
      message: "回答中没有标准表格。",
      repair: "Excel 将生成成果概览和章节内容表。",
    });
  }
  return issues;
}

export function planArtifact(
  title: string,
  content: string,
  format: ExportFormat,
): ArtifactPlan {
  const artifact = buildArtifactSpec(title, content);
  const issues = inspectArtifact(artifact, format);
  const warningCount = issues.filter((issue) => issue.level === "warning").length;
  return {
    artifact,
    estimatedUnits: estimateUnits(format, artifact),
    unitLabel: getUnitLabel(format),
    issues,
    score: Math.max(60, 100 - warningCount * 12),
  };
}

export function repairArtifactContent(
  content: string,
  format: ExportFormat,
): string {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (format !== "pptx" && format !== "png" && format !== "svg") {
    return normalized;
  }

  return normalized
    .split("\n")
    .map((line) => {
      const bullet = /^(\s*[-*+]\s+)(.+)$/.exec(line);
      if (!bullet || bullet[2].length <= 110) return line;
      return `${bullet[1]}${bullet[2].slice(0, 109)}…`;
    })
    .join("\n");
}
