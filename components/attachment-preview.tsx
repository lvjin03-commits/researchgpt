"use client";

import { CloseIcon, DocumentIcon } from "@/components/icons";
import type { PendingAttachment } from "@/lib/uploads/client-attachments";

type AttachmentPreviewProps = {
  attachments: PendingAttachment[];
  disabled?: boolean;
  onRemove: (id: string) => void;
};

export function AttachmentPreview({
  attachments,
  disabled = false,
  onRemove,
}: AttachmentPreviewProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group relative flex max-w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5"
        >
          {attachment.kind === "image" && attachment.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.previewUrl}
              alt={attachment.file.name}
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white">
              <DocumentIcon className="h-4 w-4 text-gray-500" />
            </div>
          )}

          <span className="max-w-[140px] truncate text-xs text-gray-700 sm:max-w-[180px]">
            {attachment.file.name}
          </span>

          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            disabled={disabled}
            aria-label={`Remove ${attachment.file.name}`}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
