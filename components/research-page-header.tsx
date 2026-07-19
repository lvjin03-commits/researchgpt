"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type ResearchPageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  maxWidth?: "4xl" | "5xl" | "6xl";
};

const PRIMARY_NAV = [
  { href: "/literature", label: "文献工作台", match: "/literature" },
  { href: "/presentation", label: "成果制作", match: "/presentation" },
  { href: "/translate", label: "学术翻译", match: "/translate" },
  { href: "/chat", label: "AI 对话", match: "/chat" },
  { href: "/usage", label: "AI 成本", match: "/usage" },
] as const;

const LITERATURE_NAV = [
  { href: "/literature", label: "搜索与追踪" },
  { href: "/literature/library", label: "文献库" },
  { href: "/literature/reading", label: "单篇精读" },
  { href: "/literature/review", label: "文献分析" },
] as const;

const MAX_WIDTH_CLASS = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

function isExactOrChild(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ResearchPageHeader({
  title,
  description,
  actions,
  maxWidth = "5xl",
}: ResearchPageHeaderProps) {
  const pathname = usePathname();
  const isLiteratureWorkspace = pathname.startsWith("/literature");

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 sm:px-6">
        <div
          className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} items-center justify-between gap-6 py-3`}
        >
          <Link href="/literature" className="shrink-0 text-sm font-bold text-gray-950">
            ResearchAI
          </Link>
          <nav
            aria-label="主要功能"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            {PRIMARY_NAV.map((item) => {
              const active = pathname.startsWith(item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md border px-3 py-2 text-sm font-bold transition-colors ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-800 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {isLiteratureWorkspace && (
        <div className="border-b border-gray-100 px-4 sm:px-6">
          <nav
            aria-label="文献工作台"
            className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} gap-6 overflow-x-auto`}
          >
            {LITERATURE_NAV.map((item) => {
              const active =
                item.href === "/literature"
                  ? pathname === item.href
                  : item.href === "/literature/review"
                    ? isExactOrChild(pathname, item.href) ||
                      /^\/literature\/papers\/[^/]+\/reading(?:\/|$)/.test(pathname)
                    : item.href === "/literature/reading"
                      ? isExactOrChild(pathname, item.href) ||
                        /^\/literature\/papers\/[^/]+\/reading(?:\/|$)/.test(pathname)
                    : isExactOrChild(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-bold transition-colors ${
                    active
                      ? "border-blue-700 text-blue-800"
                      : "border-transparent text-gray-700 hover:text-gray-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <div className="px-4 py-5 sm:px-6">
        <div
          className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-950">{title}</h1>
            <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}
