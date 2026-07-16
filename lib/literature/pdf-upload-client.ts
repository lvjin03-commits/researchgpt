// Client-only module. PDF bytes go directly to Supabase Storage, not through Vercel.

import { createClient } from "@/lib/supabase/client";

const LITERATURE_PDFS_BUCKET = "literature-pdfs";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "paper"}.pdf`;
}

function createUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assertPdf(file: File): void {
  if (file.size <= 0) throw new Error("PDF 文件为空。");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF 不能超过 50 MB。");
  if (!file.name.toLowerCase().endsWith(".pdf") && !file.type.toLowerCase().includes("pdf")) {
    throw new Error("请选择 PDF 文件。");
  }
}

export async function uploadLiteraturePdfDirect(file: File): Promise<{
  storagePath: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  cleanup: () => Promise<void>;
}> {
  assertPdf(file);
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) throw new Error("登录已失效，请重新登录后上传。");

  const fileName = sanitizeFileName(file.name);
  const storagePath = `${user.id}/uploads/${createUploadId()}-${fileName}`;
  const { error } = await supabase.storage
    .from(LITERATURE_PDFS_BUCKET)
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) {
    throw new Error(`PDF 上传失败：${error.message}`);
  }

  return {
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    cleanup: async () => {
      await supabase.storage.from(LITERATURE_PDFS_BUCKET).remove([storagePath]);
    },
  };
}
