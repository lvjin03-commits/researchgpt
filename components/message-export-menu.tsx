"use client";

import { useState } from "react";
import { ArtifactGenerationDialog } from "@/components/artifact-generation-dialog";
import { ExportIcon } from "@/components/icons";

type MessageExportMenuProps = {
  content: string;
  chatTitle: string;
};

export function MessageExportMenu({
  content,
  chatTitle,
}: MessageExportMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mt-1.5 flex flex-col items-start">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="生成成果文件"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-white hover:text-gray-950"
      >
        <ExportIcon className="h-3.5 w-3.5" />
        生成文件
      </button>
      <ArtifactGenerationDialog
        open={open}
        title={chatTitle}
        content={content}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
