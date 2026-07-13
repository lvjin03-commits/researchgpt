"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  PRESENTATION_TEMPLATES,
  type PresentationTemplate,
} from "@/lib/presentation/templates";
import type { PresentationTemplateId } from "@/lib/literature/review/types";

type PresentationTemplatePickerProps = {
  value: PresentationTemplateId;
  onChange: (value: PresentationTemplateId) => void;
  disabled?: boolean;
};

function ModernBlueMockup({ large = false }: { large?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden border border-slate-200 bg-white ${large ? "aspect-video w-full" : "aspect-video w-full"}`}
    >
      <div className="absolute inset-x-0 top-0 h-[4%] bg-blue-600" />
      <div className="absolute left-[7%] top-[12%] h-[9%] w-[57%] bg-slate-900" />
      <div className="absolute left-[7%] top-[26%] h-[4%] w-[76%] bg-blue-100" />
      <div className="absolute bottom-[12%] left-[7%] top-[37%] w-[45%] bg-slate-50 ring-1 ring-slate-200" />
      <div className="absolute right-[8%] top-[40%] h-[8%] w-[31%] bg-blue-600" />
      <div className="absolute right-[8%] top-[55%] h-[5%] w-[31%] bg-slate-300" />
      <div className="absolute right-[8%] top-[67%] h-[5%] w-[25%] bg-slate-300" />
    </div>
  );
}

export function PresentationTemplatePicker({
  value,
  onChange,
  disabled = false,
}: PresentationTemplatePickerProps) {
  const [previewTemplate, setPreviewTemplate] =
    useState<PresentationTemplate | null>(null);

  useEffect(() => {
    if (!previewTemplate) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewTemplate(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewTemplate]);

  return (
    <>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">选择 PPT 模板</h3>
          <p className="mt-1 text-xs text-gray-500">
            切换模板不会重新调用 AI，可在导出前随时更换。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESENTATION_TEMPLATES.map((template) => {
            const selected = template.id === value;
            return (
              <div
                key={template.id}
                className={`overflow-hidden border bg-white ${
                  selected
                    ? "border-blue-600 ring-2 ring-blue-100"
                    : "border-gray-200"
                }`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(template.id)}
                  className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="relative aspect-video overflow-hidden bg-gray-100">
                    {template.previewImages[0] ? (
                      <Image
                        src={template.previewImages[0]}
                        alt={`${template.name}封面预览`}
                        fill
                        sizes="(max-width: 640px) 100vw, 420px"
                        className="object-cover"
                      />
                    ) : (
                      <ModernBlueMockup />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 border border-black/10"
                        style={{ backgroundColor: template.accent }}
                      />
                      <span className="text-sm font-semibold text-gray-900">
                        {template.name}
                      </span>
                      {selected && (
                        <span className="ml-auto text-xs font-medium text-blue-700">
                          已选择
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      {template.description}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(template)}
                  className="w-full border-t border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  预览模板
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {previewTemplate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${previewTemplate.name}模板预览`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPreviewTemplate(null);
          }}
        >
          <div className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {previewTemplate.name}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  封面、内容结构、流程与时间轴页面示例
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                aria-label="关闭模板预览"
                className="h-9 w-9 border border-gray-200 text-xl text-gray-600 hover:bg-gray-100"
              >
                ×
              </button>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              {previewTemplate.previewImages.length > 0 ? (
                previewTemplate.previewImages.map((src, index) => (
                  <figure key={src} className="border border-gray-200 bg-gray-100 p-2">
                    <Image
                      src={src}
                      alt={`${previewTemplate.name}第 ${index + 1} 张预览`}
                      width={1600}
                      height={900}
                      className="h-auto w-full"
                    />
                    <figcaption className="px-1 pt-2 text-xs text-gray-500">
                      {index === 0
                        ? "封面"
                        : index === 1
                          ? "结构图"
                          : index === 2
                            ? "流程图"
                            : "时间轴"}
                    </figcaption>
                  </figure>
                ))
              ) : (
                <div className="md:col-span-2">
                  <ModernBlueMockup large />
                </div>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4">
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(previewTemplate.id);
                  setPreviewTemplate(null);
                }}
                className="bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                使用此模板
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
