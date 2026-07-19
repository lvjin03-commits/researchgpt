"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PresentationTemplatePicker } from "@/components/presentation-template-picker";
import { ResearchPageHeader } from "@/components/research-page-header";
import { exportLiteratureReview, LiteratureError } from "@/lib/literature/client";
import { REVIEW_MODEL_OPTIONS } from "@/lib/literature/review/constants";
import type {
  PresentationDeck,
  PresentationSlide,
  PresentationTemplateId,
  ReviewModel,
} from "@/lib/literature/review/types";
import {
  DEFAULT_PRESENTATION_TEMPLATE_ID,
  isPresentationTemplateId,
} from "@/lib/presentation/templates";

const STORAGE_KEY = "researchai:outline-to-ppt:v1";

export function PresentationShell() {
  const [title, setTitle] = useState("");
  const [outline, setOutline] = useState("");
  const [model, setModel] = useState<ReviewModel>("gpt-5.4-mini");
  const [templateId, setTemplateId] = useState<PresentationTemplateId>(
    DEFAULT_PRESENTATION_TEMPLATE_ID,
  );
  const [deck, setDeck] = useState<PresentationDeck | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as {
          title?: string;
          outline?: string;
          model?: ReviewModel;
          templateId?: PresentationTemplateId;
          deck?: PresentationDeck;
        };
        setTitle(saved.title ?? "");
        setOutline(saved.outline ?? "");
        if (saved.model) setModel(saved.model);
        if (isPresentationTemplateId(saved.templateId)) {
          setTemplateId(saved.templateId);
        }
        setDeck(saved.deck ?? null);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setDraftLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ title, outline, model, templateId, deck }),
    );
  }, [deck, draftLoaded, model, outline, templateId, title]);

  const generateDeck = async () => {
    if (!title.trim()) {
      setError("请填写PPT标题。");
      return;
    }
    if (outline.trim().length < 20) {
      setError("请粘贴较完整的PPT大纲。");
      return;
    }

    setError(null);
    setMessage(null);
    setIsGenerating(true);
    try {
      const response = await fetch("/api/presentation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), outline: outline.trim(), model }),
      });
      const payload = (await response.json()) as {
        deck?: PresentationDeck;
        error?: string;
      };
      if (!response.ok || !payload.deck) {
        throw new LiteratureError(payload.error ?? "生成PPT方案失败。", response.status);
      }
      setDeck(payload.deck);
      setMessage(`已生成 ${payload.deck.slides.length} 页结构化PPT方案。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成PPT方案失败。");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateSlide = (slideId: string, patch: Partial<PresentationSlide>) => {
    setDeck((current) =>
      current
        ? {
            ...current,
            slides: current.slides.map((slide) =>
              slide.id === slideId ? { ...slide, ...patch } : slide,
            ),
          }
        : current,
    );
  };

  const exportDeck = async () => {
    if (!deck) return;
    setError(null);
    setIsExporting(true);
    try {
      const result = await exportLiteratureReview({
        format: "pptx",
        title: title.trim() || deck.title,
        content: JSON.stringify(deck),
        templateId,
      });
      setMessage(`已导出 ${result.filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出PPT失败。");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="research-canvas min-h-dvh">
      <ResearchPageHeader
        title="成果制作"
        description="将已有大纲转换为可编辑的结构化学术 PPT。"
      />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <ol className="research-surface grid rounded-md sm:grid-cols-4" aria-label="PPT 制作流程">
          {[
            ["01", "内容来源"],
            ["02", "生成大纲"],
            ["03", "选择模板"],
            ["04", "导出成果"],
          ].map(([number, label], index) => (
            <li
              key={number}
              className={`flex items-center gap-3 px-4 py-3 ${
                index < 3 ? "border-b border-[#e4eaec] sm:border-b-0 sm:border-r" : ""
              }`}
            >
              <span className="font-mono text-xs font-bold text-[#147565]">{number}</span>
              <span className="text-sm font-bold text-[#42545c]">{label}</span>
            </li>
          ))}
        </ol>
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-gray-950">选择内容来源</h2>
            <p className="mt-1 text-sm text-gray-500">
              已有大纲可直接制作；尚未整理文献时先进入文献分析。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border-2 border-[#174866] bg-[#eaf2f5] p-4">
              <p className="text-sm font-semibold text-blue-950">已有大纲</p>
              <p className="mt-1 text-sm leading-6 text-blue-800">
                粘贴自己的 PPT 大纲，选择模板后生成演示文稿。
              </p>
            </div>
            <Link
              href="/literature/review"
              className="rounded-md border border-[#d4dfe2] bg-white p-4 transition-colors hover:border-[#9fb5be] hover:bg-[#f7fafb]"
            >
              <p className="text-sm font-semibold text-gray-950">从文献开始</p>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                先生成文献矩阵和证据大纲，再继续制作 PPT。
              </p>
            </Link>
          </div>
        </section>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </p>
        )}

        <section className="research-surface space-y-5 rounded-md p-5">
          <div className="border-b border-[#e4eaec] pb-3">
            <p className="research-eyebrow">Presentation brief</p>
            <h2 className="mt-1 text-lg font-bold text-[#172126]">定义学术汇报</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-gray-900">PPT标题</span>
              <input
                value={title}
                disabled={isGenerating}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setDeck(null);
                }}
                placeholder="例如：有机催化的发展与研究前沿"
                className="research-focus rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm outline-none"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-gray-900">AI模型</span>
              <select
                value={model}
                disabled={isGenerating}
                onChange={(event) => setModel(event.target.value as ReviewModel)}
                className="research-focus rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm outline-none"
              >
                {REVIEW_MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {option.badge}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-gray-900">PPT大纲</span>
            <textarea
              value={outline}
              disabled={isGenerating}
              rows={11}
              onChange={(event) => {
                setOutline(event.target.value);
                setDeck(null);
              }}
              placeholder={"粘贴已有大纲，例如：\n1. 研究背景\n2. 核心科学问题\n3. 技术发展时间线\n4. 代表性方法比较\n5. 研究空白与未来方向"}
              className="research-focus rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm leading-6 outline-none"
            />
          </label>
          <PresentationTemplatePicker
            value={templateId}
            onChange={setTemplateId}
            disabled={isGenerating || isExporting}
          />
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void generateDeck()}
            className="rounded-md bg-[#174866] px-5 py-3 text-sm font-bold text-white hover:bg-[#123a52] disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isGenerating ? "正在生成结构化PPT..." : "根据大纲生成PPT"}
          </button>
        </section>

        {deck && (
          <section className="research-surface space-y-4 rounded-md p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">逐页PPT方案</h2>
                <p className="mt-1 text-sm text-gray-500">
                  可修改标题、结论和要点。图片不足的页面已保留占位建议。
                </p>
              </div>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void exportDeck()}
                className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {isExporting ? "正在导出..." : "导出 PPTX"}
              </button>
            </div>
            <div className="space-y-3">
              {deck.slides.map((slide, index) => (
                <article
                  key={slide.id}
                  className="grid gap-4 rounded-xl border border-gray-200 p-4 lg:grid-cols-[100px_minmax(0,1fr)_270px]"
                >
                  <div className="text-sm text-gray-500">
                    <p className="font-semibold">第 {index + 1} 页</p>
                    <p className="mt-2">{slide.type}</p>
                  </div>
                  <div className="grid gap-3">
                    <input
                      value={slide.title}
                      onChange={(event) =>
                        updateSlide(slide.id, { title: event.target.value })
                      }
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold"
                    />
                    <input
                      value={slide.takeaway}
                      onChange={(event) =>
                        updateSlide(slide.id, { takeaway: event.target.value })
                      }
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
                    />
                    <textarea
                      value={slide.bullets.join("\n")}
                      rows={4}
                      onChange={(event) =>
                        updateSlide(slide.id, {
                          bullets: event.target.value
                            .split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean)
                            .slice(0, 4),
                        })
                      }
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6"
                    />
                  </div>
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-500">
                      {slide.visual.mode === "placeholder" ? "图片占位" : "图示规划"}
                    </p>
                    <p className="mt-2 text-sm font-medium text-gray-900">
                      {slide.visual.title || slide.visual.type}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      {slide.visual.description || "本页无需额外图片。"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
