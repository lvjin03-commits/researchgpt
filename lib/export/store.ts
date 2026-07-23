// Server-only module. Do not import from client components or /api/chat route entry.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { ExportRecord } from "@/lib/export/types";

const EXPORT_DIR = path.join(os.tmpdir(), "researchgpt-exports");
const EXPORT_TTL_MS = 60 * 60 * 1000;
const CLOUD_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getMetaPath(id: string): string {
  return path.join(EXPORT_DIR, `${id}.meta.json`);
}

function getDataPath(id: string): string {
  return path.join(EXPORT_DIR, `${id}.data`);
}

function getCloudMetaPath(userId: string, id: string): string {
  return `${userId}/exports/${id}.meta.json`;
}

function getCloudDataPath(userId: string, id: string, filename: string): string {
  const safeFilename = filename.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 120);
  return `${userId}/exports/${id}-${safeFilename || "export.bin"}`;
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

async function readCloudMeta(
  id: string,
  userId: string,
): Promise<ExportRecord | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .download(getCloudMetaPath(userId, id));

    if (error || !data) {
      return null;
    }

    return JSON.parse(await data.text()) as ExportRecord;
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

  const id = randomUUID();
  const storagePath = getCloudDataPath(input.userId, id, input.filename);
  const cloudRecord: ExportRecord = {
    id,
    filename: input.filename,
    mimeType: input.mimeType,
    userId: input.userId,
    createdAt: Date.now(),
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
  };

  try {
    const supabase = await createClient();
    const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
    const { error: dataError } = await bucket.upload(
      storagePath,
      input.buffer,
      {
        contentType: input.mimeType,
        upsert: false,
      },
    );

    if (dataError) {
      throw dataError;
    }

    const { error: metaError } = await bucket.upload(
      getCloudMetaPath(input.userId, id),
      Buffer.from(JSON.stringify(cloudRecord), "utf8"),
      {
        contentType: "application/json; charset=utf-8",
        upsert: false,
      },
    );

    if (metaError) {
      await bucket.remove([storagePath]);
      throw metaError;
    }

    return cloudRecord;
  } catch (error) {
    console.warn("[export] Cloud export storage failed, falling back to temp:", error);
  }

  await ensureExportDir();
  const filePath = getDataPath(id);
  const localRecord: ExportRecord = {
    id,
    filename: input.filename,
    mimeType: input.mimeType,
    userId: input.userId,
    createdAt: Date.now(),
    filePath,
  };

  await fs.writeFile(filePath, input.buffer);
  await fs.writeFile(getMetaPath(id), JSON.stringify(localRecord), "utf8");

  return localRecord;
}

export async function getExportForUser(
  id: string,
  userId: string,
): Promise<ExportRecord | null> {
  const record = (await readCloudMeta(id, userId)) ?? (await readMeta(id));

  if (!record) {
    return null;
  }

  if (record.userId !== userId) {
    return null;
  }

  const ttl = record.storagePath ? CLOUD_EXPORT_TTL_MS : EXPORT_TTL_MS;
  if (Date.now() - record.createdAt > ttl) {
    if (record.storagePath) {
      const supabase = await createClient();
      await supabase.storage
        .from(record.storageBucket ?? CHAT_ATTACHMENTS_BUCKET)
        .remove([record.storagePath, getCloudMetaPath(record.userId, id)]);
    } else {
      await deleteExport(id);
    }
    return null;
  }

  if (record.storagePath) {
    return record;
  }

  if (!record.filePath) {
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
  if (record.storagePath) {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(record.storageBucket ?? CHAT_ATTACHMENTS_BUCKET)
      .download(record.storagePath);

    if (error || !data) {
      throw new Error("Stored export file is unavailable.");
    }

    return Buffer.from(await data.arrayBuffer());
  }

  if (!record.filePath) {
    throw new Error("Export file path is missing.");
  }

  return fs.readFile(record.filePath);
}

export async function deleteExport(id: string): Promise<void> {
  const record = await readMeta(id);
  if (record?.storagePath) {
    const supabase = await createClient();
    await supabase.storage
      .from(record.storageBucket ?? CHAT_ATTACHMENTS_BUCKET)
      .remove([record.storagePath, getCloudMetaPath(record.userId, id)]);
  }

  await Promise.allSettled([
    fs.unlink(getMetaPath(id)),
    record?.filePath ? fs.unlink(record.filePath) : Promise.resolve(),
    fs.unlink(getDataPath(id)),
  ]);
}
