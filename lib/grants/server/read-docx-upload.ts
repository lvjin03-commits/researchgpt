import "server-only";
import { GrantDocxImportError, MAX_GRANT_DOCX_BYTES } from "../imports/docx-importer.ts";

const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

export async function readGrantDocxUpload(request: Request): Promise<{ fileName: string; buffer: Buffer }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_GRANT_DOCX_BYTES + MAX_MULTIPART_OVERHEAD) {
    throw new GrantDocxImportError("DOCX 不能超过 20 MB。", "file_too_large", 413);
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new GrantDocxImportError("请选择 DOCX 初稿。", "invalid_file", 400);
  return { fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
}
