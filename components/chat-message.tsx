"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageExportMenu } from "@/components/message-export-menu";
import type { DisplayChatMessage } from "@/lib/chat/types";
import { DocumentIcon, ImageIcon } from "@/components/icons";

type ChatMessageProps = {
  message: DisplayChatMessage;
  chatTitle: string;
  onEdit?: () => void;
  onRetry?: () => void;
};

type ChartSpec = {
  type: "bar" | "line";
  title: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  xAxis?: string;
  yAxis?: string;
  unit?: string;
  caption?: string;
  source?: string;
  evidenceType?: "user_data" | "literature" | "ai_structure";
};

function parseChartSpec(value: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(value) as Partial<ChartSpec>;
    if (
      (parsed.type !== "bar" && parsed.type !== "line") ||
      typeof parsed.title !== "string" ||
      !Array.isArray(parsed.labels) ||
      !parsed.labels.every((label) => typeof label === "string") ||
      !Array.isArray(parsed.series) ||
      parsed.series.length === 0
    ) {
      return null;
    }

    const series = parsed.series.filter(
      (item): item is { name: string; values: number[] } =>
        typeof item?.name === "string" &&
        Array.isArray(item.values) &&
        item.values.length === parsed.labels!.length &&
        item.values.every(Number.isFinite),
    );
    if (series.length === 0 || parsed.labels.length > 24 || series.length > 4) {
      return null;
    }

    return {
      type: parsed.type,
      title: parsed.title,
      labels: parsed.labels,
      series,
      xAxis: typeof parsed.xAxis === "string" ? parsed.xAxis : undefined,
      yAxis: typeof parsed.yAxis === "string" ? parsed.yAxis : undefined,
      unit: typeof parsed.unit === "string" ? parsed.unit : undefined,
      caption: typeof parsed.caption === "string" ? parsed.caption : undefined,
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      evidenceType:
        parsed.evidenceType === "user_data" ||
        parsed.evidenceType === "literature" ||
        parsed.evidenceType === "ai_structure"
          ? parsed.evidenceType
          : undefined,
    };
  } catch {
    return null;
  }
}

function ChartBlock({ value }: { value: string }) {
  const chart = parseChartSpec(value);
  if (!chart) {
    return <CodeBlock language="chart">{value}</CodeBlock>;
  }

  const width = 720;
  const height = 330;
  const margin = { top: 24, right: 20, bottom: 64, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = chart.series.flatMap((item) => item.values);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const y = (value: number) =>
    margin.top + ((maximum - value) / range) * plotHeight;
  const zeroY = y(0);
  const colors = ["#2563eb", "#0f766e", "#d97706", "#7c3aed"];
  const groupWidth = plotWidth / Math.max(chart.labels.length, 1);
  const barWidth = Math.min(
    34,
    (groupWidth * 0.72) / Math.max(chart.series.length, 1),
  );

  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <figcaption className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-950">
        <BarChart3 className="h-4 w-4 text-blue-600" />
        {chart.title}
      </figcaption>
      <div className="overflow-x-auto p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[620px]"
          role="img"
          aria-label={chart.title}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const tickValue = maximum - range * ratio;
            const tickY = margin.top + plotHeight * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={tickY}
                  y2={tickY}
                  stroke="#e5e7eb"
                />
                <text
                  x={margin.left - 8}
                  y={tickY + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#6b7280"
                >
                  {Number(tickValue.toPrecision(4))}
                </text>
              </g>
            );
          })}
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={zeroY}
            y2={zeroY}
            stroke="#9ca3af"
          />
          {(chart.yAxis || chart.unit) && (
            <text
              x="14"
              y={margin.top + plotHeight / 2}
              textAnchor="middle"
              fontSize="11"
              fill="#4b5563"
              transform={`rotate(-90 14 ${margin.top + plotHeight / 2})`}
            >
              {[chart.yAxis, chart.unit ? `(${chart.unit})` : ""]
                .filter(Boolean)
                .join(" ")}
            </text>
          )}
          {chart.xAxis && (
            <text
              x={margin.left + plotWidth / 2}
              y={height - 23}
              textAnchor="middle"
              fontSize="11"
              fill="#4b5563"
            >
              {chart.xAxis}
            </text>
          )}

          {chart.type === "bar"
            ? chart.series.flatMap((series, seriesIndex) =>
                series.values.map((value, valueIndex) => {
                  const x =
                    margin.left +
                    valueIndex * groupWidth +
                    (groupWidth - barWidth * chart.series.length) / 2 +
                    seriesIndex * barWidth;
                  const valueY = y(value);
                  return (
                    <rect
                      key={`${series.name}-${valueIndex}`}
                      x={x}
                      y={Math.min(valueY, zeroY)}
                      width={Math.max(barWidth - 2, 2)}
                      height={Math.max(Math.abs(zeroY - valueY), 1)}
                      fill={colors[seriesIndex]}
                      rx="2"
                    />
                  );
                }),
              )
            : chart.series.map((series, seriesIndex) => {
                const points = series.values
                  .map((value, index) => {
                    const x =
                      margin.left + groupWidth * index + groupWidth / 2;
                    return `${x},${y(value)}`;
                  })
                  .join(" ");
                return (
                  <g key={series.name}>
                    <polyline
                      points={points}
                      fill="none"
                      stroke={colors[seriesIndex]}
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                    {series.values.map((value, index) => (
                      <circle
                        key={`${series.name}-${index}`}
                        cx={margin.left + groupWidth * index + groupWidth / 2}
                        cy={y(value)}
                        r="4"
                        fill={colors[seriesIndex]}
                      />
                    ))}
                  </g>
                );
              })}

          {chart.labels.map((label, index) => (
            <text
              key={`${label}-${index}`}
              x={margin.left + groupWidth * index + groupWidth / 2}
              y={height - 38}
              textAnchor="middle"
              fontSize="11"
              fill="#4b5563"
            >
              {label.length > 12 ? `${label.slice(0, 11)}…` : label}
            </text>
          ))}

          {chart.series.map((series, index) => (
            <g
              key={series.name}
              transform={`translate(${margin.left + index * 150}, ${height - 12})`}
            >
              <rect width="12" height="12" rx="2" fill={colors[index]} />
              <text x="18" y="10" fontSize="11" fill="#374151">
                {series.name.slice(0, 18)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <VisualEvidenceFooter visual={chart} />
    </figure>
  );
}

type VisualEvidence = {
  caption?: string;
  source?: string;
  evidenceType?: "user_data" | "literature" | "ai_structure";
};

type FishboneSpec = VisualEvidence & {
  type: "fishbone";
  title: string;
  problem: string;
  branches: Array<{ name: string; causes: string[] }>;
};

type ProcessSpec = VisualEvidence & {
  type: "process";
  title: string;
  steps: Array<{ title: string; description?: string }>;
};

type TimelineSpec = VisualEvidence & {
  type: "timeline";
  title: string;
  events: Array<{ label: string; title: string; description?: string }>;
};

type StructureVisualSpec = FishboneSpec | ProcessSpec | TimelineSpec;

const EVIDENCE_LABELS = {
  user_data: "用户数据",
  literature: "文献证据",
  ai_structure: "AI 证据结构图",
} as const;

function normalizeVisualEvidence(
  parsed: Record<string, unknown>,
): VisualEvidence {
  return {
    caption: typeof parsed.caption === "string" ? parsed.caption : undefined,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    evidenceType:
      parsed.evidenceType === "user_data" ||
      parsed.evidenceType === "literature" ||
      parsed.evidenceType === "ai_structure"
        ? parsed.evidenceType
        : undefined,
  };
}

function parseStructureVisualSpec(value: string): StructureVisualSpec | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.title !== "string") return null;
    const evidence = normalizeVisualEvidence(parsed);

    if (
      parsed.type === "fishbone" &&
      typeof parsed.problem === "string" &&
      Array.isArray(parsed.branches)
    ) {
      const branches = parsed.branches
        .flatMap((branch) => {
          if (typeof branch !== "object" || branch === null) return [];
          const record = branch as Record<string, unknown>;
          if (typeof record.name !== "string" || !Array.isArray(record.causes)) {
            return [];
          }
          const causes = record.causes
            .filter((cause): cause is string => typeof cause === "string")
            .slice(0, 5);
          return causes.length > 0
            ? [{ name: record.name, causes }]
            : [];
        })
        .slice(0, 6);

      return branches.length > 0
        ? {
            type: "fishbone",
            title: parsed.title,
            problem: parsed.problem,
            branches,
            ...evidence,
          }
        : null;
    }

    if (parsed.type === "process" && Array.isArray(parsed.steps)) {
      const steps = parsed.steps
        .flatMap((step) => {
          if (typeof step !== "object" || step === null) return [];
          const record = step as Record<string, unknown>;
          if (typeof record.title !== "string") return [];
          return [
            {
              title: record.title,
              description:
                typeof record.description === "string"
                  ? record.description
                  : undefined,
            },
          ];
        })
        .slice(0, 8);

      return steps.length > 0
        ? { type: "process", title: parsed.title, steps, ...evidence }
        : null;
    }

    if (parsed.type === "timeline" && Array.isArray(parsed.events)) {
      const events = parsed.events
        .flatMap((event) => {
          if (typeof event !== "object" || event === null) return [];
          const record = event as Record<string, unknown>;
          if (
            typeof record.label !== "string" ||
            typeof record.title !== "string"
          ) {
            return [];
          }
          return [
            {
              label: record.label,
              title: record.title,
              description:
                typeof record.description === "string"
                  ? record.description
                  : undefined,
            },
          ];
        })
        .slice(0, 8);

      return events.length > 0
        ? { type: "timeline", title: parsed.title, events, ...evidence }
        : null;
    }

    return null;
  } catch {
    return null;
  }
}

function VisualEvidenceFooter({ visual }: { visual: VisualEvidence }) {
  if (!visual.caption && !visual.source && !visual.evidenceType) return null;

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600">
      <div className="flex flex-wrap items-center gap-2">
        {visual.evidenceType && (
          <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
            {EVIDENCE_LABELS[visual.evidenceType]}
          </span>
        )}
        {visual.caption && <span>{visual.caption}</span>}
      </div>
      {visual.source && (
        <p className="mt-1 text-gray-500">来源：{visual.source}</p>
      )}
      {visual.evidenceType === "ai_structure" && (
        <p className="mt-1 text-amber-700">
          本图为基于现有信息整理的结构图，不代表原始实验数据。
        </p>
      )}
    </div>
  );
}

function FishboneBlock({ visual }: { visual: FishboneSpec }) {
  const top = visual.branches.filter((_, index) => index % 2 === 0);
  const bottom = visual.branches.filter((_, index) => index % 2 === 1);
  const boneXs = [300, 510, 720];

  const renderBone = (
    branch: FishboneSpec["branches"][number],
    index: number,
    position: "top" | "bottom",
  ) => {
    const baseX = boneXs[index] ?? boneXs[boneXs.length - 1];
    const isTop = position === "top";
    const tipX = baseX - 92;
    const tipY = isTop ? 100 : 460;
    const labelY = isTop ? 42 : 478;
    const causesY = isTop ? 88 : 318;

    return (
      <g key={`${position}-${branch.name}-${index}`}>
        <line
          x1={baseX}
          y1="280"
          x2={tipX}
          y2={tipY}
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={baseX} cy="280" r="5" fill="#1d4ed8" />
        <rect
          x={tipX - 55}
          y={labelY}
          width="110"
          height="34"
          rx="6"
          fill="#eff6ff"
          stroke="#2563eb"
          strokeWidth="1.5"
        />
        <foreignObject
          x={tipX - 50}
          y={labelY + 3}
          width="100"
          height="28"
        >
          <div className="flex h-full items-center justify-center text-center text-[13px] font-bold leading-4 text-blue-950">
            {branch.name}
          </div>
        </foreignObject>
        <foreignObject
          x={tipX - 152}
          y={causesY}
          width="150"
          height="150"
        >
          <div
            className={`h-full text-[11px] leading-[17px] text-gray-700 ${
              isTop ? "flex flex-col justify-end" : ""
            }`}
          >
            {branch.causes.map((cause) => (
              <div
                key={cause}
                className="border-b border-dashed border-blue-100 py-0.5"
              >
                {cause}
              </div>
            ))}
          </div>
        </foreignObject>
      </g>
    );
  };

  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <figcaption className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-950">
        <BarChart3 className="h-4 w-4 text-blue-600" />
        {visual.title}
      </figcaption>
      <div className="overflow-x-auto bg-gradient-to-b from-white to-blue-50/30 p-3 sm:p-4">
        <svg
          viewBox="0 0 1000 560"
          role="img"
          aria-label={`${visual.title}：${visual.problem}`}
          className="mx-auto block h-auto min-w-[720px] max-w-[1100px]"
        >
          <defs>
            <marker
              id="fishbone-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill="#1d4ed8" />
            </marker>
          </defs>

          <path
            d="M38 280 L100 235 L88 280 L100 325 Z"
            fill="#eff6ff"
            stroke="#2563eb"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <line
            x1="90"
            y1="280"
            x2="824"
            y2="280"
            stroke="#1d4ed8"
            strokeWidth="5"
            strokeLinecap="round"
            markerEnd="url(#fishbone-arrow)"
          />

          {top.map((branch, index) => renderBone(branch, index, "top"))}
          {bottom.map((branch, index) => renderBone(branch, index, "bottom"))}

          <path
            d="M820 205 Q930 208 972 280 Q930 352 820 355 Q850 280 820 205 Z"
            fill="#eff6ff"
            stroke="#1d4ed8"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="920" cy="245" r="6" fill="#1d4ed8" />
          <foreignObject x="850" y="252" width="103" height="82">
            <div className="flex h-full items-center justify-center text-center text-[12px] font-bold leading-[17px] text-blue-950">
              {visual.problem}
            </div>
          </foreignObject>
        </svg>
      </div>
      <VisualEvidenceFooter visual={visual} />
    </figure>
  );
}

function ProcessBlock({ visual }: { visual: ProcessSpec }) {
  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <figcaption className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-950">
        <BarChart3 className="h-4 w-4 text-blue-600" />
        {visual.title}
      </figcaption>
      <div className="overflow-x-auto p-4">
        <div className="flex min-w-max items-stretch">
          {visual.steps.map((step, index) => (
            <div key={`${step.title}-${index}`} className="flex items-center">
              <div className="w-44 border-t-4 border-blue-600 bg-blue-50 px-3 py-3">
                <p className="text-xs font-bold text-blue-600">
                  步骤 {index + 1}
                </p>
                <p className="mt-1 text-sm font-bold text-gray-950">
                  {step.title}
                </p>
                {step.description && (
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    {step.description}
                  </p>
                )}
              </div>
              {index < visual.steps.length - 1 && (
                <div className="mx-2 text-xl font-bold text-blue-500">→</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <VisualEvidenceFooter visual={visual} />
    </figure>
  );
}

function TimelineBlock({ visual }: { visual: TimelineSpec }) {
  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <figcaption className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-950">
        <BarChart3 className="h-4 w-4 text-blue-600" />
        {visual.title}
      </figcaption>
      <div className="overflow-x-auto p-4">
        <div className="flex min-w-max items-start">
          {visual.events.map((event, index) => (
            <div key={`${event.label}-${index}`} className="relative w-48 pr-5">
              <div className="mb-3 flex items-center">
                <span className="h-3 w-3 rounded-full bg-blue-600 ring-4 ring-blue-100" />
                {index < visual.events.length - 1 && (
                  <span className="h-0.5 flex-1 bg-blue-200" />
                )}
              </div>
              <p className="text-xs font-bold text-blue-700">{event.label}</p>
              <p className="mt-1 text-sm font-bold text-gray-950">
                {event.title}
              </p>
              {event.description && (
                <p className="mt-1 text-xs leading-5 text-gray-600">
                  {event.description}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      <VisualEvidenceFooter visual={visual} />
    </figure>
  );
}

function ScientificVisualBlock({ value }: { value: string }) {
  const chart = parseChartSpec(value);
  if (chart) return <ChartBlock value={value} />;

  const visual = parseStructureVisualSpec(value);
  if (!visual) return <CodeBlock language="visual">{value}</CodeBlock>;
  if (visual.type === "fishbone") return <FishboneBlock visual={visual} />;
  if (visual.type === "process") return <ProcessBlock visual={visual} />;
  return <TimelineBlock visual={visual} />;
}

function splitSources(content: string): {
  body: string;
  sources: Array<{ title: string; url: string }>;
} {
  const marker = "\n### 来源";
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex < 0) return { body: content, sources: [] };

  const sourceText = content.slice(markerIndex + marker.length);
  const sources = Array.from(
    sourceText.matchAll(/\d+\.\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g),
  ).map((match) => ({ title: match[1], url: match[2] }));

  return sources.length > 0
    ? { body: content.slice(0, markerIndex).trimEnd(), sources }
    : { body: content, sources: [] };
}

function splitImageGallery(content: string): {
  body: string;
  images: Array<{ title: string; imageUrl: string; sourceUrl: string }>;
} {
  const marker = "\n### 相关图片";
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex < 0) return { body: content, images: [] };

  const imageText = content.slice(markerIndex + marker.length);
  const images = imageText.split("\n").flatMap((line) => {
    const match =
      /^\d+\.\s+\[!\[(.*?)\]\((https?:\/\/.+)\)\]\((https?:\/\/.+)\)$/.exec(
        line.trim(),
      );
    if (!match) return [];
    return [{ title: match[1], imageUrl: match[2], sourceUrl: match[3] }];
  });

  return images.length > 0
    ? { body: content.slice(0, markerIndex).trimEnd(), images }
    : { body: content, images: [] };
}

function CodeBlock({
  children,
  language,
}: {
  children: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-gray-800 bg-[#171717] text-gray-100">
      <div className="flex h-9 items-center justify-between border-b border-white/10 px-3 text-xs text-gray-400">
        <span>{language || "代码"}</span>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-gray-300 hover:bg-white/10 hover:text-white"
          aria-label="复制代码"
          title="复制代码"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  const sourceSplit = splitSources(content);
  const imageSplit = splitImageGallery(sourceSplit.body);
  const body = imageSplit.body;
  const sources = sourceSplit.sources;
  const images = imageSplit.images;
  return (
    <div className="min-w-0 text-[15px] leading-7 text-gray-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-7 text-2xl font-bold leading-8 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2.5 mt-7 text-xl font-bold leading-7 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-6 text-base font-bold leading-6 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-3 whitespace-pre-wrap break-words first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-950">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-gray-500">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:font-medium marker:text-gray-600">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-blue-500 bg-blue-50 px-4 py-2 text-gray-700">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-gray-200" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 w-full overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-50 text-gray-950">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-gray-200 px-3 py-2.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-gray-100 px-3 py-2.5 align-top last:border-b-0">
              {children}
            </td>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const language = /language-([\w-]+)/.exec(className || "")?.[1];
            const value = String(children).replace(/\n$/, "");
            const isBlock = Boolean(className) || value.includes("\n");

            if (language === "chart" || language === "visual") {
              return <ScientificVisualBlock value={value} />;
            }

            if (isBlock) {
              return <CodeBlock language={language}>{value}</CodeBlock>;
            }

            return (
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.88em] text-gray-900">
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
      {images.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950">
            <ImageIcon className="h-4 w-4 text-blue-600" />
            相关图片
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {images.map((image, index) => (
              <a
                key={`${image.imageUrl}-${index}`}
                href={image.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-lg border border-gray-200 bg-gray-50 no-underline transition hover:border-blue-300 hover:shadow-sm"
              >
                {/* External source previews intentionally use the cited page URL. */}
                <img
                  src={image.imageUrl}
                  alt={image.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-[4/3] w-full bg-gray-100 object-cover"
                />
                <span className="flex items-start justify-between gap-2 px-3 py-2 text-xs leading-5 text-gray-700">
                  <span className="line-clamp-2">{image.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-blue-600" />
                </span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            图片来自对应引用网页，点击可查看原始来源。
          </p>
        </section>
      )}
      {sources.length > 0 && (
        <section className="mt-6 border-t border-gray-200 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-950">
            来源 {sources.length}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {sources.map((source, index) => (
              <a
                key={`${source.url}-${index}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-14 items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-5 text-gray-700 no-underline transition hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="line-clamp-2">
                  <span className="mr-1.5 font-semibold text-gray-500">
                    {index + 1}.
                  </span>
                  {source.title}
                </span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-blue-600" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AttachmentList({
  attachments,
  isUser,
}: {
  attachments: NonNullable<DisplayChatMessage["attachments"]>;
  isUser: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment, attachmentIndex) => {
        const AttachmentIcon =
          attachment.kind === "image" ? ImageIcon : DocumentIcon;

        return (
          <div
            key={`${attachment.name}-${attachmentIndex}`}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
              isUser
                ? "bg-white/10 text-gray-100"
                : "border border-gray-200 bg-white text-gray-600"
            }`}
          >
            <AttachmentIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{attachment.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
    >
      {children}
    </button>
  );
}

export function ChatMessageBubble({
  message,
  chatTitle,
  onEdit,
  onRetry,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const canExport =
    message.role === "assistant" && message.content.trim().length > 0;
  const [copied, setCopied] = useState(false);

  async function copyResponse() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[88%] sm:max-w-[75%]">
          <div className="rounded-2xl bg-gray-900 px-4 py-3 text-[15px] leading-7 text-white">
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentList attachments={message.attachments} isUser />
            )}
            {message.content && (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="mt-1 block px-1 text-xs font-medium text-gray-400 hover:text-gray-700"
            >
              编辑
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <article className="w-full min-w-0">
      {message.attachments && message.attachments.length > 0 && (
        <AttachmentList attachments={message.attachments} isUser={false} />
      )}

      {message.content && <AssistantMarkdown content={message.content} />}

      {canExport && (
        <div className="mt-2 flex min-h-8 items-center gap-0.5">
          <ActionButton label={copied ? "已复制" : "复制回答"} onClick={() => void copyResponse()}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </ActionButton>
          {onRetry && (
            <ActionButton label="重新生成" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
            </ActionButton>
          )}
          <MessageExportMenu content={message.content} chatTitle={chatTitle} />
        </div>
      )}
    </article>
  );
}
