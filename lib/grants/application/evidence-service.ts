import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_GRANT_EVIDENCE_PERMISSIONS,
  GrantEvidenceResourceSchema,
  type GrantEvidenceCard,
  type GrantEvidenceResource,
} from "../evidence/contracts.ts";
import type { GrantEvidenceParser } from "../ports/grant-evidence-parser.ts";
import type { GrantEvidenceRepository } from "../ports/grant-evidence-repository.ts";
import type { GrantEvidenceStorage } from "../ports/grant-evidence-storage.ts";
import { GrantRevisionService } from "./revision-service.ts";
import { GrantEvidenceAuthorizationService, GrantEvidenceNotFoundError } from "./evidence-authorization-service.ts";

const MAX_CARD_CHARS = 1800;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function chunkEvidence(text: string): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n+/u).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CARD_CHARS) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += MAX_CARD_CHARS) {
        chunks.push(paragraph.slice(start, start + MAX_CARD_CHARS));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CARD_CHARS) {
      chunks.push(current);
      current = paragraph;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

export class GrantEvidenceService {
  readonly authorization: GrantEvidenceAuthorizationService;
  private readonly revisionService: GrantRevisionService;
  private readonly repository: GrantEvidenceRepository;
  private readonly storage: GrantEvidenceStorage;
  private readonly parser: GrantEvidenceParser;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    revisionService: GrantRevisionService,
    repository: GrantEvidenceRepository,
    storage: GrantEvidenceStorage,
    parser: GrantEvidenceParser,
    authorization?: GrantEvidenceAuthorizationService,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.revisionService = revisionService;
    this.repository = repository;
    this.storage = storage;
    this.parser = parser;
    this.createId = createId;
    this.now = now;
    this.authorization = authorization ?? new GrantEvidenceAuthorizationService(repository, now);
  }

  async list(documentId: string) {
    await this.revisionService.getDocument(documentId);
    return this.repository.listResources(documentId);
  }

  async upload(input: {
    ownerId: string;
    actorId: string;
    documentId: string;
    fileName: string;
    mediaType: string;
    buffer: Buffer;
    provenanceType: "published_literature" | "own_unpublished_work" | "project_material";
    sensitivity: "public" | "project_confidential" | "unpublished_research" | "highly_sensitive";
  }): Promise<GrantEvidenceResource> {
    await this.revisionService.getDocument(input.documentId);
    const parsed = await this.parser.parse({ buffer: input.buffer, fileName: input.fileName });
    const chunks = chunkEvidence(parsed.text);
    if (chunks.length === 0) throw new Error("No readable evidence cards could be produced.");
    const sourceId = this.createId();
    const timestamp = this.now();
    const checksum = sha256(input.buffer);
    const stored = await this.storage.store({
      ownerId: input.ownerId,
      documentId: input.documentId,
      sourceId,
      buffer: input.buffer,
      mediaType: input.mediaType,
      checksum,
    });
    const cards: GrantEvidenceCard[] = chunks.map((excerpt, order) => ({
      cardId: this.createId(),
      documentId: input.documentId,
      sourceId,
      order,
      excerpt,
      excerptHash: sha256(excerpt),
      locator: { kind: "text_chunk", chunkIndex: order },
      status: "active",
      createdAt: timestamp,
    }));
    const resource = GrantEvidenceResourceSchema.parse({
      source: {
        sourceId,
        documentId: input.documentId,
        title: input.fileName.replace(/\.[^.]+$/u, "") || input.fileName,
        fileName: input.fileName,
        mediaType: input.mediaType || "application/octet-stream",
        byteSize: input.buffer.byteLength,
        contentHash: checksum,
        provenanceType: input.provenanceType,
        sensitivity: input.sensitivity,
        status: "active",
        storage: stored,
        extraction: { originalLength: parsed.originalLength, truncated: parsed.truncated, cardCount: cards.length },
        createdBy: input.actorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      authorization: {
        authorizationId: this.createId(),
        documentId: input.documentId,
        sourceId,
        revision: 1,
        permissions: DEFAULT_GRANT_EVIDENCE_PERMISSIONS,
        updatedBy: input.actorId,
        updatedAt: timestamp,
      },
      cards,
    });
    try {
      return await this.repository.createResource(resource);
    } catch (error) {
      await this.storage.remove(stored).catch(() => undefined);
      throw error;
    }
  }

  async delete(input: { documentId: string; sourceId: string; actorId: string }) {
    await this.revisionService.getDocument(input.documentId);
    const existing = await this.repository.getResource(input.documentId, input.sourceId);
    if (!existing) throw new GrantEvidenceNotFoundError("Evidence source was not found.");
    const deletedAt = this.now();
    const pending = existing.source.status === "deletion_pending"
      ? existing
      : await this.repository.beginDeletion({ ...input, deletedAt });
    if (pending.source.storage) await this.storage.remove(pending.source.storage);
    return this.repository.completeDeletion({ ...input, deletedAt: this.now() });
  }
}
