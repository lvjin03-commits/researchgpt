"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/icons";

const EXTENSION_INSTALL_URL =
  process.env.NEXT_PUBLIC_GOOGLE_SCHOLAR_EXTENSION_URL?.trim() ?? "";

const INSTRUCTIONS = [
  {
    title: "安装并固定插件",
    description: "从 Chrome 商店安装 ResearchAI Scholar Saver，并固定到浏览器工具栏。",
  },
  {
    title: "连接 ResearchAI 账户",
    description: "先登录本网站，再打开插件并点击 Connect account（连接账户）。",
  },
  {
    title: "加载文献夹",
    description: "点击 Load folders（加载文件夹），并选择保存 PDF 的默认文献夹。",
  },
  {
    title: "在 Scholar 保存 PDF",
    description: "有直接 PDF 的结果旁会显示 Save PDF to ResearchGPT，点击后即可保存全文。",
  },
] as const;

export function ScholarExtensionEntry() {
  const [showInstructions, setShowInstructions] = useState(false);
  const hasInstallUrl = Boolean(EXTENSION_INSTALL_URL);

  return (
    <>
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">Google Scholar 保存助手</p>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              可选安装。将 Scholar 中可下载的 PDF 直接保存到文献夹。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
            可选
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {hasInstallUrl ? (
            <a
              href={EXTENSION_INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-blue-700 px-3 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-blue-800"
            >
              安装插件
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setShowInstructions(true)}
              className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2.5 text-sm font-bold text-gray-600"
            >
              一键安装
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            查看使用说明
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-gray-500">
          不安装插件也可以先下载 PDF，再到文献库手动上传。
        </p>
      </div>

      {showInstructions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowInstructions(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="scholar-extension-title"
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <h2
                  id="scholar-extension-title"
                  className="text-lg font-semibold text-gray-950"
                >
                  Google Scholar 保存助手
                </h2>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  用于保存 PDF 全文，不是使用网站核心功能的必要条件。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                aria-label="关闭使用说明"
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            <div className="px-5 py-5">
              {!hasInstallUrl && (
                <p className="mb-5 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  Chrome 商店版本尚未发布。正式链接上线后，这里会自动显示“安装插件”。
                </p>
              )}

              <ol className="space-y-5">
                {INSTRUCTIONS.map((item, index) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-gray-950">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        {item.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 border-t border-gray-200 pt-4 text-sm leading-6 text-gray-600">
                <p>只有检测到直接 PDF 的结果才显示保存入口。</p>
                <p>下载受阻时，请先完成下载，再选择该 PDF 上传。</p>
                <p>登录失效时，重新连接账户并加载文件夹后重试。</p>
              </div>
            </div>

            <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50"
              >
                知道了
              </button>
              {hasInstallUrl && (
                <a
                  href={EXTENSION_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
                >
                  前往安装
                </a>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
