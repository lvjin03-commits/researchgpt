import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { GrantFigureMediaTypeSchema, type GrantFigureMediaType } from "../domain/figure-assets.ts";

type Relationship = {
  id: string;
  target: string;
  external: boolean;
};

export type ExtractedGrantDocxFigure = {
  assetId: string;
  buffer: Buffer;
  contentHash: string;
  mediaType: GrantFigureMediaType;
  widthPx: number | null;
  heightPx: number | null;
  sourceOrdinal: number;
  relationshipId: string;
  partName: string;
  anchorKind: "inline" | "floating";
  altText: string | null;
};

export type GrantDocxFigureExtractionIssue = {
  code: "image_relationship_invalid" | "image_media_unsupported" | "image_part_missing";
  relationshipId: string | null;
  partName: string | null;
};

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function relationshipsById(zip: AdmZip): Map<string, Relationship> {
  const xml = zip.getEntry("word/_rels/document.xml.rels")?.getData().toString("utf8") ?? "";
  const result = new Map<string, Relationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]+?)\/?\s*>/gi)) {
    const attributes = match[1] ?? "";
    const id = /\bId="([^"]+)"/i.exec(attributes)?.[1];
    const target = /\bTarget="([^"]+)"/i.exec(attributes)?.[1];
    if (!id || !target) continue;
    result.set(id, {
      id,
      target: decodeXmlAttribute(target),
      external: /\bTargetMode="External"/i.test(attributes),
    });
  }
  return result;
}

function contentTypesByExtension(zip: AdmZip): Map<string, string> {
  const xml = zip.getEntry("[Content_Types].xml")?.getData().toString("utf8") ?? "";
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Default\b([^>]+?)\/?\s*>/gi)) {
    const attributes = match[1] ?? "";
    const extension = /\bExtension="([^"]+)"/i.exec(attributes)?.[1]?.toLowerCase();
    const mediaType = /\bContentType="([^"]+)"/i.exec(attributes)?.[1]?.toLowerCase();
    if (extension && mediaType) result.set(extension, mediaType);
  }
  return result;
}

function resolvePartName(target: string): string | null {
  const normalized = path.posix.normalize(path.posix.join("word", target.replaceAll("\\", "/")));
  if (!normalized.startsWith("word/") || normalized.includes("../")) return null;
  return normalized;
}

function imageRelationshipId(xml: string): string | null {
  return /<a:blip\b[^>]*\br:embed="([^"]+)"/i.exec(xml)?.[1]
    ?? /<v:imagedata\b[^>]*\br:id="([^"]+)"/i.exec(xml)?.[1]
    ?? null;
}

function imageAltText(xml: string): string | null {
  const attributes = /<wp:docPr\b([^>]*)>/i.exec(xml)?.[1] ?? "";
  for (const attribute of ["descr", "title", "name"]) {
    const value = new RegExp(`\\b${attribute}="([^"]+)"`, "i").exec(attributes)?.[1];
    if (value) return decodeXmlAttribute(value).slice(0, 1000);
  }
  return null;
}

async function inspectDimensions(buffer: Buffer): Promise<{ widthPx: number | null; heightPx: number | null }> {
  try {
    const metadata = await sharp(buffer, { failOn: "none" }).metadata();
    return {
      widthPx: Number.isInteger(metadata.width) && (metadata.width ?? 0) > 0 ? metadata.width! : null,
      heightPx: Number.isInteger(metadata.height) && (metadata.height ?? 0) > 0 ? metadata.height! : null,
    };
  } catch {
    return { widthPx: null, heightPx: null };
  }
}

export async function extractGrantDocxFigures(zip: AdmZip): Promise<{
  figures: ExtractedGrantDocxFigure[];
  issues: GrantDocxFigureExtractionIssue[];
}> {
  const documentXml = zip.getEntry("word/document.xml")?.getData().toString("utf8") ?? "";
  const relationships = relationshipsById(zip);
  const contentTypes = contentTypesByExtension(zip);
  const figures: ExtractedGrantDocxFigure[] = [];
  const issues: GrantDocxFigureExtractionIssue[] = [];
  const drawingPattern = /<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/gi;

  for (const [sourceOrdinal, match] of [...documentXml.matchAll(drawingPattern)].entries()) {
    const xml = match[0];
    const relationshipId = imageRelationshipId(xml);
    const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!relationshipId || !relationship || relationship.external) {
      issues.push({ code: "image_relationship_invalid", relationshipId, partName: null });
      continue;
    }
    const partName = resolvePartName(relationship.target);
    if (!partName) {
      issues.push({ code: "image_relationship_invalid", relationshipId, partName: null });
      continue;
    }
    const entry = zip.getEntry(partName);
    if (!entry || entry.isDirectory) {
      issues.push({ code: "image_part_missing", relationshipId, partName });
      continue;
    }
    const extension = path.posix.extname(partName).slice(1).toLowerCase();
    const mediaTypeResult = GrantFigureMediaTypeSchema.safeParse(contentTypes.get(extension));
    if (!mediaTypeResult.success) {
      issues.push({ code: "image_media_unsupported", relationshipId, partName });
      continue;
    }
    const buffer = entry.getData();
    if (buffer.byteLength === 0) {
      issues.push({ code: "image_part_missing", relationshipId, partName });
      continue;
    }
    const dimensions = await inspectDimensions(buffer);
    figures.push({
      assetId: randomUUID(),
      buffer,
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      mediaType: mediaTypeResult.data,
      ...dimensions,
      sourceOrdinal,
      relationshipId,
      partName,
      anchorKind: /<wp:anchor\b/i.test(xml) ? "floating" : "inline",
      altText: imageAltText(xml),
    });
  }
  return { figures, issues };
}
