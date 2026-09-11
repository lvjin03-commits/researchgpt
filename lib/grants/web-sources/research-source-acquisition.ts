import { z } from "zod";
import type { GrantAcademicSourceRecord } from "./academic-source-contracts.ts";
import type { GrantWebSourceRecord } from "./contracts.ts";

export type GrantResearchSourceMember =
  | { sourceKind: "structured_academic"; evidenceKind: "abstract" | "metadata_only"; record: GrantAcademicSourceRecord }
  | { sourceKind: "general_web"; evidenceKind: "citation_context"; record: GrantWebSourceRecord };

export type GrantResearchSourceGroup = {
  groupId: string;
  deduplicationKey: string;
  primarySourceId: string;
  members: GrantResearchSourceMember[];
};

const DOI_PATTERN = /10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/u;

function normalizeDoi(value: string): string | null {
  const decoded = decodeURIComponent(value).match(DOI_PATTERN)?.[0];
  return decoded ? decoded.replace(/[).,;]+$/u, "").toLowerCase() : null;
}

function doiFor(member: GrantResearchSourceMember): string | null {
  if (member.sourceKind === "structured_academic") {
    return member.record.publication.doi ? normalizeDoi(member.record.publication.doi) : null;
  }
  try {
    const url = new URL(member.record.canonicalUrl);
    return url.hostname.toLowerCase() === "doi.org" || url.hostname.toLowerCase() === "dx.doi.org"
      ? normalizeDoi(`${url.pathname}${url.search}`) : null;
  } catch { return null; }
}

function normalizedUrl(member: GrantResearchSourceMember): string {
  const url = new URL(member.record.canonicalUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function normalizedTitle(member: GrantResearchSourceMember): string {
  return member.record.title.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function candidateKeys(member: GrantResearchSourceMember): string[] {
  const doi = doiFor(member);
  return [...(doi ? [`doi:${doi}`] : []), `url:${normalizedUrl(member)}`, `title:${normalizedTitle(member)}`];
}

function memberPriority(member: GrantResearchSourceMember): number {
  if (member.sourceKind === "structured_academic" && member.evidenceKind === "abstract") return 0;
  if (member.sourceKind === "structured_academic") return 1;
  return member.record.classification.qualityTier === "official_institution" ? 2 : 3;
}

function publicationYear(member: GrantResearchSourceMember): number {
  if (member.sourceKind === "structured_academic") return member.record.publication.publicationYear ?? 0;
  return member.record.publishedAt ? new Date(member.record.publishedAt).getUTCFullYear() : 0;
}

export function composeGrantResearchSources(input: {
  academicSources: readonly GrantAcademicSourceRecord[];
  generalWebSources: readonly GrantWebSourceRecord[];
  createId: () => string;
}): GrantResearchSourceGroup[] {
  const members: GrantResearchSourceMember[] = [
    ...input.academicSources.map((record): GrantResearchSourceMember => ({
      sourceKind: "structured_academic",
      evidenceKind: record.evidence.kind,
      record,
    })),
    ...input.generalWebSources.map((record): GrantResearchSourceMember => ({
      sourceKind: "general_web",
      evidenceKind: "citation_context",
      record,
    })),
  ];
  const sourceIds = members.map((member) => member.record.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Research source IDs must be unique before composition.");

  const groups: GrantResearchSourceGroup[] = [];
  const groupByKey = new Map<string, GrantResearchSourceGroup>();
  for (const member of members) {
    const keys = candidateKeys(member);
    const matching = [...new Set(keys.map((key) => groupByKey.get(key)).filter((group): group is GrantResearchSourceGroup => Boolean(group)))];
    if (matching.length > 1) throw new Error("Ambiguous source identity joins multiple existing research-source groups.");
    let group = matching[0];
    if (!group) {
      group = { groupId: z.string().uuid().parse(input.createId()), deduplicationKey: keys[0]!,
        primarySourceId: member.record.sourceId, members: [] };
      groups.push(group);
    }
    group.members.push(member);
    group.members.sort((left, right) => memberPriority(left) - memberPriority(right)
      || left.record.sourceId.localeCompare(right.record.sourceId));
    group.primarySourceId = group.members[0]!.record.sourceId;
    for (const groupMember of group.members) for (const key of candidateKeys(groupMember)) groupByKey.set(key, group);
  }

  return groups.sort((left, right) => {
    const leftPrimary = left.members.find((member) => member.record.sourceId === left.primarySourceId)!;
    const rightPrimary = right.members.find((member) => member.record.sourceId === right.primarySourceId)!;
    return publicationYear(rightPrimary) - publicationYear(leftPrimary)
      || leftPrimary.record.title.localeCompare(rightPrimary.record.title)
      || left.groupId.localeCompare(right.groupId);
  });
}

