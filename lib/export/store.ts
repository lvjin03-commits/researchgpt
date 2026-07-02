// Server-only module. Do not import from client components or /api/chat route entry.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { ExportRecord } from "@/lib/export/types";

const EXPORT_DIR = path.join(os.tmpdir(), "researchgpt-exports");
const EXPORT_TTL_MS = 60 * 60 * 1000;

function getMetaPath(id: string): string {
  return path.join(EXPORT_DIR, `${id}.meta.json`);
}

function getDataPath(id: string): string {
  return path.join(EXPORT_DIR, `${id}.data`);
}

async function ensureExportDir(): Promise<void> {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
}

async function readMeta(id: string): Promise<ExportRecord | null> {
  try {
    const raw = await fs.readFile(getMetaPath(id), "utf8");
    const parsed = JSON.parse(raw) as ExportRecord;
    return parsed;
  } catch {
    return null;
  }
}

async function cleanupExpiredExports(): Promise<void> {
  await ensureExportDir();

  let entries: string[];

  try {
    entries = await fs.readdir(EXPORT_DIR);
  } catch {
    return;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (!entry.endsWith(".meta.json")) {
      continue;
    }

    const id = entry.replace(/\.meta\.json$/, "");
    const record = await readMeta(id);

    if (!record || now - record.createdAt > EXPORT_TTL_MS) {
      await deleteExport(id);
    }
  }
}

export async function saveExport(input: {
  filename: string;
  mimeType: string;
  userId: string;
  buffer: Buffer;
}): Promise<ExportRecord> {
  await cleanupExpiredExports();
  await ensureExportDir();

  const id = randomUUID();
  const filePath = getDataPath(id);
  const record: ExportRecord = {
    id,
    filename: input.filename,
    mimeType: input.mimeType,
    userId: input.userId,
    createdAt: Date.now(),
    filePath,
  };

  await fs.writeFile(filePath, input.buffer);
  await fs.writeFile(getMetaPath(id), JSON.stringify(record), "utf8");

  return record;
}

export async function getExportForUser(
  id: string,
  userId: string,
): Promise<ExportRecord | null> {
  const record = await readMeta(id);

  if (!record) {
    return null;
  }

  if (record.userId !== userId) {
    return null;
  }

  if (Date.now() - record.createdAt > EXPORT_TTL_MS) {
    await deleteExport(id);
    return null;
  }

  try {
    await fs.access(record.filePath);
    return record;
  } catch {
    await deleteExport(id);
    return null;
  }
}

export async function readExportBuffer(record: ExportRecord): Promise<Buffer> {
  return fs.readFile(record.filePath);
}

export async function deleteExport(id: string): Promise<void> {
  const record = await readMeta(id);

  await Promise.allSettled([
    fs.unlink(getMetaPath(id)),
    record ? fs.unlink(record.filePath) : Promise.resolve(),
    fs.unlink(getDataPath(id)),
  ]);
}
