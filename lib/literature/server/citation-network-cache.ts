// Server-only module.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { PaperCitationNetwork } from "@/lib/literature/types";

const CITATION_NETWORK_CACHE_DIR = path.join(
  os.tmpdir(),
  "researchgpt-literature",
  "citation-network",
);

const CITATION_NETWORK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CitationNetworkCacheEntry = {
  cachedAt: string;
  data: PaperCitationNetwork;
};

function cachePath(paperId: string): string {
  const safeId = paperId.replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(CITATION_NETWORK_CACHE_DIR, `${safeId}.json`);
}

function isValidCacheEntry(
  entry: CitationNetworkCacheEntry | null,
): entry is CitationNetworkCacheEntry {
  if (!entry?.cachedAt || !entry.data) {
    return false;
  }

  const cachedAt = new Date(entry.cachedAt).getTime();
  if (Number.isNaN(cachedAt)) {
    return false;
  }

  return Date.now() - cachedAt <= CITATION_NETWORK_CACHE_TTL_MS;
}

export async function getCachedCitationNetwork(
  paperId: string,
): Promise<PaperCitationNetwork | null> {
  try {
    const raw = await fs.readFile(cachePath(paperId), "utf8");
    const entry = JSON.parse(raw) as CitationNetworkCacheEntry;
    return isValidCacheEntry(entry) ? entry.data : null;
  } catch {
    return null;
  }
}

export async function setCachedCitationNetwork(
  paperId: string,
  data: PaperCitationNetwork,
): Promise<void> {
  const entry: CitationNetworkCacheEntry = {
    cachedAt: new Date().toISOString(),
    data,
  };

  await fs.mkdir(CITATION_NETWORK_CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(paperId), JSON.stringify(entry), "utf8");
}
