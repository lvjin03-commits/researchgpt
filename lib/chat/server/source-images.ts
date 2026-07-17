// Server-only module. Extracts public preview images from cited web pages.

import { isIP } from "node:net";

export type WebSource = {
  title: string;
  url: string;
};

export type SourceImage = {
  title: string;
  imageUrl: string;
  sourceUrl: string;
  sourceTitle: string;
};

const MAX_HTML_BYTES = 600_000;
const MAX_IMAGES = 3;

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname === "0.0.0.0" ||
      hostname === "::1"
    ) {
      return false;
    }

    if (isIP(hostname) === 4 && isPrivateIpv4(hostname)) return false;
    if (isIP(hostname) === 6 && (hostname.startsWith("fc") || hostname.startsWith("fd"))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function readMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeHtml(match[1].trim());
    }
  }
  return null;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  let currentUrl = url;

  for (let redirect = 0; redirect < 3; redirect += 1) {
    if (!isSafePublicUrl(currentUrl)) return null;

    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; ResearchGPT/1.0; +https://researchgpt-ivory.vercel.app)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) return null;

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) return null;

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { html, finalUrl: currentUrl };
  }

  return null;
}

async function extractSourceImage(source: WebSource): Promise<SourceImage | null> {
  try {
    const page = await fetchHtml(source.url);
    if (!page) return null;

    const image = readMeta(page.html, [
      "og:image:secure_url",
      "og:image",
      "twitter:image",
      "twitter:image:src",
    ]);
    if (!image) return null;

    const imageUrl = new URL(image, page.finalUrl).toString();
    if (!isSafePublicUrl(imageUrl)) return null;

    const title =
      readMeta(page.html, ["og:image:alt", "twitter:image:alt"]) ??
      source.title;

    return {
      title,
      imageUrl,
      sourceUrl: source.url,
      sourceTitle: source.title,
    };
  } catch {
    return null;
  }
}

export async function extractImagesFromSources(
  sources: WebSource[],
): Promise<SourceImage[]> {
  const candidates = await Promise.all(
    sources.slice(0, 6).map(extractSourceImage),
  );
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    if (!candidate || seen.has(candidate.imageUrl)) return [];
    seen.add(candidate.imageUrl);
    return [candidate];
  }).slice(0, MAX_IMAGES);
}
