import { createHash } from "node:crypto";
import type {
  ApprovedDocumentBlock,
  FinalDocumentSpec,
} from "../contracts";

export type CitationOccurrence = {
  blockId: string;
  segmentId: string;
  segmentOrder: number;
  referenceId: string;
};

export type CitationManifest = {
  policyVersion: string;
  sourceContentHash: string;
  referenceSetHash: string;
  orderedReferenceIds: string[];
  occurrences: CitationOccurrence[];
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function deriveCitationOccurrences(input: {
  blocks: ReadonlyArray<ApprovedDocumentBlock>;
  includeAbstract: boolean;
}): CitationOccurrence[] {
  const occurrences: CitationOccurrence[] = [];
  for (const block of input.blocks) {
    if (block.type !== "paragraph") continue;
    if (block.role === "abstract" && !input.includeAbstract) continue;
    if (block.citationGranularity === "segment") {
      for (const segment of block.segments) {
        for (const referenceId of segment.citationIds) {
          occurrences.push({
            blockId: block.id,
            segmentId: segment.segmentId,
            segmentOrder: segment.order,
            referenceId,
          });
        }
      }
      continue;
    }
    for (const referenceId of block.citationIds) {
      occurrences.push({
        blockId: block.id,
        segmentId: `${block.id}:paragraph_legacy`,
        segmentOrder: 0,
        referenceId,
      });
    }
  }
  return occurrences;
}

export function deriveOrderedReferenceIds(input: {
  blocks: ReadonlyArray<ApprovedDocumentBlock>;
  includeAbstract: boolean;
}): string[] {
  return [
    ...new Set(
      deriveCitationOccurrences(input).map(
        (occurrence) => occurrence.referenceId,
      ),
    ),
  ];
}

export function deriveCitationManifest(
  spec: FinalDocumentSpec,
): CitationManifest {
  const policy = spec.templateSnapshot.citationPolicy;
  const occurrences = deriveCitationOccurrences({
    blocks: spec.blocks,
    includeAbstract: policy.includeAbstract,
  });

  return {
    policyVersion: policy.policyVersion,
    sourceContentHash: sha256(
      spec.blocks.map((block) =>
        block.type === "paragraph"
          ? {
              id: block.id,
              role: block.role,
              citationGranularity: block.citationGranularity,
              text: block.text,
              segments: block.segments,
            }
          : block,
      ),
    ),
    referenceSetHash: sha256(
      spec.references.map((reference) => ({
        id: reference.id,
        sourceId: reference.sourceId,
        doi: reference.doi ?? null,
        url: reference.url ?? null,
      })),
    ),
    orderedReferenceIds: [
      ...new Set(occurrences.map((occurrence) => occurrence.referenceId)),
    ],
    occurrences,
  };
}
