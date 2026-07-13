"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PresentationTemplatePicker } from "@/components/presentation-template-picker";
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
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">大纲生成 PPT</h1>
            <p className="text-sm text-gray-500">
              粘贴已有大纲，生成可编辑的结构化学术PPT。
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/literature/review"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              文献生成PPT
            </Link>
            <Link
              href="/chat"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              返回对话
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
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

        <section className="space-y-5 rounded-2xl border border-gray-200 p-5 shadow-sm">
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
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-gray-900">AI模型</span>
              <select
                value={model}
                disabled={isGenerating}
                onChange={(event) => setModel(event.target.value as ReviewModel)}
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
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
              rows={16}
              onChange={(event) => {
                setOutline(event.target.value);
                setDeck(null);
              }}
              placeholder={"粘贴已有大纲，例如：\n1. 研究背景\n2. 核心科学问题\n3. 技术发展时间线\n4. 代表性方法比较\n5. 研究空白与未来方向"}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-6"
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
            className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isGenerating ? "正在生成结构化PPT..." : "根据大纲生成PPT"}
          </button>
        </section>

        {deck && (
          <section className="space-y-4 rounded-2xl border border-gray-200 p-5 shadow-sm">
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
