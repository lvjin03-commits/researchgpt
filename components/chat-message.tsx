"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
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
        {content}
      </ReactMarkdown>
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
