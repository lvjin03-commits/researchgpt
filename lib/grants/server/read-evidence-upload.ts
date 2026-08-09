import "server-only";

export class GrantEvidenceUploadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "GrantEvidenceUploadError";
    this.code = code;
    this.status = status;
  }
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

export async function readGrantEvidenceUpload(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + MAX_MULTIPART_OVERHEAD) {
    throw new GrantEvidenceUploadError("file_too_large", "项目资料不能超过 20 MB。", 413);
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new GrantEvidenceUploadError("invalid_file", "请选择项目资料。", 400);
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new GrantEvidenceUploadError("unsupported_file", "当前支持 PDF、DOCX、TXT 和 Markdown。", 415);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new GrantEvidenceUploadError("empty_file", "项目资料为空。", 400);
  if (buffer.byteLength > MAX_BYTES) throw new GrantEvidenceUploadError("file_too_large", "项目资料不能超过 20 MB。", 413);
  return {
    fileName: file.name,
    mediaType: file.type || "application/octet-stream",
    buffer,
    provenanceType: String(form.get("provenanceType") ?? "published_literature"),
    sensitivity: String(form.get("sensitivity") ?? "project_confidential"),
  };
}
