import { createHash } from "crypto";
import { LiteratureError } from "@/lib/literature/errors";
import { parseExtensionFolderIds } from "@/lib/literature/server/extension-paper";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { registerUploadedLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import {
  deleteLiteraturePaper,
  stripLiteraturePaperFullTextForResponse,
  updateLiteraturePaperStatus,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import type { ArxivPaperDraft } from "@/lib/literature/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type DirectUploadPayload = {
  folderIds?: unknown;
  storagePath?: unknown;
  fileName?: unknown;
  fileSize?: unknown;
  lastModified?: unknown;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled PDF";
}

function parsePayload(raw: DirectUploadPayload, userId: string) {
  const storagePath = cleanString(raw.storagePath);
  const fileName = cleanString(raw.fileName);
  const fileSize = Number(raw.fileSize);
  const lastModified = Number(raw.lastModified);

  if (!storagePath.startsWith(`${userId}/`) || !storagePath.toLowerCase().endsWith(".pdf")) {
    throw new LiteratureError("Invalid PDF storage path.", 403);
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new LiteratureError("Uploaded file must be a PDF.", 415);
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 50 * 1024 * 1024) {
    throw new LiteratureError("PDF size is invalid or exceeds 50 MB.", 413);
  }

  return {
    folderIds: parseExtensionFolderIds(raw.folderIds),
    storagePath,
    fileName,
    fileSize,
    lastModified: Number.isFinite(lastModified) ? lastModified : 0,
  };
}

function buildDraft(input: ReturnType<typeof parsePayload>): ArxivPaperDraft {
  const digest = createHash("sha1")
    .update(`${input.fileName}:${input.fileSize}:${input.lastModified}`)
    .digest("hex")
    .slice(0, 16);
  const localUrl = `local-pdf:${digest}`;

  return {
    arxivId: localUrl,
    title: titleFromFileName(input.fileName),
    abstract: "Local PDF uploaded to the literature library.",
    authors: [],
    publishedAt: null,
    pdfUrl: localUrl,
    absUrl: localUrl,
    categories: ["source:Local PDF"],
    citationCount: null,
    rankingScore: 100,
  };
}

export async function POST(request: Request) {
  let uploadedPath = "";
  let savedPaperId = "";

  try {
    const { supabase, user } = await requireLiteratureUser();
    const raw = (await request.json()) as DirectUploadPayload;
    const input = parsePayload(raw, user.id);
    uploadedPath = input.storagePath;
    const draft = buildDraft(input);

    const pathParts = input.storagePath.split("/");
    const storedFileName = pathParts.pop() ?? "";
    const storedFolder = pathParts.join("/");
    const { data: storedFiles, error: storageError } = await supabase.storage
      .from("literature-pdfs")
      .list(storedFolder, { limit: 10, search: storedFileName });
    const stored = storedFiles?.some((item) => item.name === storedFileName);
    if (storageError || !stored) {
      throw new LiteratureError("PDF 上传未完成，请重新选择文件上传。", 422);
    }

    const upserted = await upsertAnalyzedPapers(supabase, user.id, [draft], new Map());
    const saved = upserted.papers.find((item) => item.arxivId === draft.arxivId);
    if (!saved) throw new LiteratureError("Uploaded paper could not be saved.", 500);
    savedPaperId = saved.id;

    let paper = await updateLiteraturePaperStatus(supabase, user.id, saved.id, "saved");
    paper = await registerUploadedLiteraturePaperPdf(supabase, user.id, paper, input);
    const folderIds = await setPaperFolderIds(supabase, user.id, paper.id, input.folderIds);

    return Response.json({
      paper: stripLiteraturePaperFullTextForResponse({ ...paper, folderIds }),
    });
  } catch (error) {
    try {
      const { supabase, user } = await requireLiteratureUser();
      if (uploadedPath.startsWith(`${user.id}/`)) {
        await supabase.storage.from("literature-pdfs").remove([uploadedPath]);
      }
      if (savedPaperId) await deleteLiteraturePaper(supabase, user.id, savedPaperId);
    } catch (cleanupError) {
      console.warn("[literature] failed to clean up direct PDF upload:", cleanupError);
    }

    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[literature] direct local PDF upload failed:", error);
    return Response.json({ error: "Failed to register uploaded PDF." }, { status: 500 });
  }
}
