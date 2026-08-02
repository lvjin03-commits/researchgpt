import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FigureAsset } from "@/lib/document-v2/assets/contracts";
import type { FinalDocumentSpec } from "@/lib/document-v2/contracts";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { ExportRecord } from "@/lib/export/types";
import type { FigureBaseAssetCache } from "./openai-adapters";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function storeDocx(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  buffer: Buffer,
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("word/document.xml")) {
    throw new Error("Rendered DOCX is invalid.");
  }
  const id = randomUUID();
  const filename = `researchgpt-${jobId}.docx`;
  const storagePath = `${ownerId}/exports/${id}-${filename}`;
  const metaPath = `${ownerId}/exports/${id}.meta.json`;
  const record: ExportRecord = {
    id,
    filename,
    mimeType: DOCX_MIME,
    userId: ownerId,
    createdAt: Date.now(),
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
  };
  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const uploaded = await bucket.upload(storagePath, buffer, {
    contentType: DOCX_MIME,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const metadata = await bucket.upload(
    metaPath,
    Buffer.from(JSON.stringify(record), "utf8"),
    { contentType: "application/json; charset=utf-8", upsert: false },
  );
  if (metadata.error) {
    await bucket.remove([storagePath]);
    throw metadata.error;
  }
  return id;
}

export async function storeFigureAsset(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  asset: FigureAsset,
): Promise<FigureAsset> {
  if (!asset.dataBase64) return asset;
  const basePath = `${ownerId}/document-v2/${jobId}/figures/${asset.requestId}/${asset.sha256}`;
  const storagePath = `${basePath}.${asset.format}`;
  const fallbackStoragePath =
    asset.format === "svg" ? `${basePath}.fallback.png` : undefined;
  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const data = Buffer.from(asset.dataBase64, "base64");
  const uploaded = await bucket.upload(storagePath, data, {
    contentType: asset.format === "svg" ? "image/svg+xml" : "image/png",
    upsert: false,
  });
  if (uploaded.error && !/already exists/i.test(uploaded.error.message)) {
    throw uploaded.error;
  }
  if (fallbackStoragePath && asset.fallbackPngBase64) {
    const fallback = await bucket.upload(
      fallbackStoragePath,
      Buffer.from(asset.fallbackPngBase64, "base64"),
      { contentType: "image/png", upsert: false },
    );
    if (fallback.error && !/already exists/i.test(fallback.error.message)) {
      throw fallback.error;
    }
  }
  return {
    ...asset,
    dataBase64: undefined,
    fallbackPngBase64: undefined,
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
    fallbackStoragePath,
    byteSize: data.byteLength,
  };
}

export async function hydrateFigureAssets(
  supabase: SupabaseClient,
  spec: FinalDocumentSpec,
): Promise<FinalDocumentSpec> {
  const assets = await Promise.all(
    spec.assets.map(async (asset) => {
      if (asset.dataBase64) return asset;
      if (!asset.storageBucket || !asset.storagePath) {
        throw new Error(`Figure asset "${asset.id}" has no storage reference.`);
      }
      const bucket = supabase.storage.from(asset.storageBucket);
      const downloaded = await bucket.download(asset.storagePath);
      if (downloaded.error || !downloaded.data) {
        throw downloaded.error ?? new Error(`Figure asset "${asset.id}" is missing.`);
      }
      let fallbackPngBase64: string | undefined;
      if (asset.fallbackStoragePath) {
        const fallback = await bucket.download(asset.fallbackStoragePath);
        if (fallback.error || !fallback.data) {
          throw fallback.error ?? new Error(`Figure fallback "${asset.id}" is missing.`);
        }
        fallbackPngBase64 = Buffer.from(
          await fallback.data.arrayBuffer(),
        ).toString("base64");
      }
      return {
        ...asset,
        dataBase64: Buffer.from(await downloaded.data.arrayBuffer()).toString(
          "base64",
        ),
        fallbackPngBase64,
      };
    }),
  );
  return { ...spec, assets };
}

export function createFigureBaseAssetCache(input: {
  supabase: SupabaseClient;
  ownerId: string;
}): FigureBaseAssetCache {
  const bucket = input.supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const basePath = (fingerprint: string) =>
    `${input.ownerId}/document-v2/image-base-cache/${fingerprint}`;
  return {
    async load(fingerprint) {
      const image = await bucket.download(`${basePath(fingerprint)}.png`);
      if (image.error || !image.data) return null;
      const metadata = await bucket.download(`${basePath(fingerprint)}.json`);
      let parsed: Record<string, string> = {};
      if (!metadata.error && metadata.data) {
        try {
          parsed = JSON.parse(await metadata.data.text()) as Record<string, string>;
        } catch {
          parsed = {};
        }
      }
      return {
        data: Buffer.from(await image.data.arrayBuffer()),
        providerRequestId: parsed.providerRequestId,
        resolvedModel: parsed.resolvedModel,
        resolvedSize: parsed.resolvedSize,
        resolvedQuality: parsed.resolvedQuality,
      };
    },
    async save(fingerprint, record) {
      const image = await bucket.upload(
        `${basePath(fingerprint)}.png`,
        record.data,
        { contentType: "image/png", upsert: false },
      );
      if (image.error && !/already exists/i.test(image.error.message)) {
        throw image.error;
      }
      const metadata = await bucket.upload(
        `${basePath(fingerprint)}.json`,
        Buffer.from(
          JSON.stringify({
            providerRequestId: record.providerRequestId,
            resolvedModel: record.resolvedModel,
            resolvedSize: record.resolvedSize,
            resolvedQuality: record.resolvedQuality,
          }),
          "utf8",
        ),
        { contentType: "application/json; charset=utf-8", upsert: false },
      );
      if (metadata.error && !/already exists/i.test(metadata.error.message)) {
        throw metadata.error;
      }
    },
  };
}
