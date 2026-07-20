"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/icons";

const EXTENSION_VERSION = "0.2.8";
const EXTENSION_DOWNLOAD_URL =
  "/downloads/researchai-scholar-saver-0.2.8.zip";

const INSTRUCTIONS = [
  {
    title: "下载并解压内测包",
    description:
      "点击“下载内测版 ZIP”，下载完成后将压缩包解压到一个固定文件夹，请勿直接在 ZIP 内打开。",
  },
  {
    title: "打开扩展程序管理页",
    description:
      "在 Chrome 地址栏输入 chrome://extensions，然后打开右上角的“开发者模式”。",
  },
  {
    title: "加载已解压的扩展程序",
    description:
      "点击“加载已解压的扩展程序”，选择刚才解压且能直接看到 manifest.json 的文件夹。",
  },
  {
    title: "连接 ResearchGPT 账户",
    description:
      "先登录本网站，再打开插件，依次点击 Connect account（连接账户）和 Load folders（加载文件夹）。",
  },
  {
    title: "在 Scholar 保存 PDF",
    description:
      "Google Scholar 中有直接 PDF 的结果旁会显示 Save PDF to ResearchGPT，点击后选择文献夹并保存全文。",
  },
] as const;

export function ScholarExtensionEntry() {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <>
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">
              Google Scholar 保存助手
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              可选内测功能。将 Scholar 中可下载的 PDF 直接保存到文献夹。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
            内测版
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <a
            href={EXTENSION_DOWNLOAD_URL}
            download
            onClick={() => setShowInstructions(true)}
            className="rounded-lg bg-blue-700 px-3 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-blue-800"
          >
            下载内测版 ZIP
          </a>
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            查看安装说明
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-gray-500">
          需要 Chrome 开发者模式。内测版不会自动更新；不安装也可以在文献库手动上传 PDF。
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
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="scholar-extension-title"
                    className="text-lg font-semibold text-gray-950"
                  >
                    安装 Google Scholar 保存助手
                  </h2>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                    内测版 {EXTENSION_VERSION}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  这是开发者模式安装包，仅建议测试用户使用。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                aria-label="关闭安装说明"
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            <div className="px-5 py-5">
              <p className="mb-5 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                Chrome 不允许普通网站静默安装扩展。内测阶段需要下载 ZIP，并在扩展程序管理页手动加载一次。
              </p>

              <ol className="space-y-5">
                {INSTRUCTIONS.map((item, index) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-gray-950">
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        {item.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 border-t border-gray-200 pt-4 text-sm leading-6 text-gray-600">
                <p>只有检测到直接 PDF 的结果才显示保存入口。</p>
                <p>更新内测版时，需要重新下载、覆盖原文件夹并在扩展页点击刷新。</p>
                <p>登录失效时，重新连接账户并加载文件夹后重试。</p>
              </div>
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50"
              >
                关闭
              </button>
              <a
                href={EXTENSION_DOWNLOAD_URL}
                download
                className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
              >
                下载内测版 ZIP
              </a>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
