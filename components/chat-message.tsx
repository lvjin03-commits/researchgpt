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
    </figure>
  );
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
  const { body, sources } = splitSources(content);
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

            if (language === "chart") {
              return <ChartBlock value={value} />;
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
