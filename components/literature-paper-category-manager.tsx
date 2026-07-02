"use client";

import { useEffect, useState } from "react";
import { setPaperCategories } from "@/lib/literature/client";
import type { LiteratureCategory } from "@/lib/literature/types";

type LiteraturePaperCategoryManagerProps = {
  paperId: string;
  selectedCategoryIds: string[];
  categories: LiteratureCategory[];
  onClose: () => void;
  onSaved: (categoryIds: string[]) => void;
};

export function LiteraturePaperCategoryManager({
  paperId,
  selectedCategoryIds,
  categories,
  onClose,
  onSaved,
}: LiteraturePaperCategoryManagerProps) {
  const [draftIds, setDraftIds] = useState<string[]>(selectedCategoryIds);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftIds(selectedCategoryIds);
  }, [selectedCategoryIds]);

  const toggleCategory = (categoryId: string) => {
    setDraftIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const savedIds = await setPaperCategories(paperId, draftIds);
      onSaved(savedIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save categories.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close category manager"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manage Categories</h2>
            <p className="mt-1 text-sm text-gray-500">
              Select one or more custom categories for this paper.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Close
          </button>
        </div>

        {categories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
            No custom categories yet. Create one in the sidebar first.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {categories.map((category) => (
              <li key={category.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 transition-colors hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={draftIds.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                  />
                  <span className="text-sm font-medium text-gray-800">{category.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || categories.length === 0}
            onClick={() => {
              void handleSave();
            }}
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
