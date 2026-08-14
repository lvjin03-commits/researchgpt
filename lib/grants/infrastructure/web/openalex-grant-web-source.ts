import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { GrantWebSearchProvider, GrantWebSourceFetcher } from "../../ports/grant-web-source-provider.ts";

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only public HTTPS sources are allowed.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Private network sources are not allowed.");
}

function abstractFromIndex(index?: Record<string, number[]> | null): string {
  if (!index) return "";
  return Object.entries(index).flatMap(([word, positions]) => positions.map((position) => ({ word, position })))
    .sort((a, b) => a.position - b.position).map((item) => item.word).join(" ");
}

export class OpenAlexGrantWebSearchProvider implements GrantWebSearchProvider {
  async search(input: { query: string; maximumResults: number }) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", input.query);
    url.searchParams.set("per-page", String(Math.min(input.maximumResults, 10)));
    url.searchParams.set("select", "id,display_name,publication_year,doi,authorships,abstract_inverted_index");
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ResearchGPT/1.0 (academic source search)" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`OpenAlex search failed with HTTP ${response.status}.`);
    const payload = await response.json() as { results?: Array<{ id?: string; display_name?: string; publication_year?: number; doi?: string; authorships?: Array<{ author?: { display_name?: string } }>; abstract_inverted_index?: Record<string, number[]> | null }> };
    return (payload.results ?? []).flatMap((work) => {
      if (!work.id || !work.display_name) return [];
      const authors = (work.authorships ?? []).slice(0, 4).map((entry) => entry.author?.display_name).filter(Boolean).join(", ");
      const abstract = abstractFromIndex(work.abstract_inverted_index).slice(0, 700);
      return [{ title: work.display_name, url: work.id.replace("https://openalex.org/", "https://api.openalex.org/works/"), snippet: [authors, work.publication_year, abstract].filter(Boolean).join(" · "), provider: "OpenAlex" }];
    });
  }
}

export class PublicWebSnapshotFetcher implements GrantWebSourceFetcher {
  async fetchSnapshot(input: { url: string; maximumBytes: number }) {
    let current = new URL(input.url);
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      await assertPublicHost(current);
      const response = await fetch(current, { redirect: "manual", headers: { Accept: "application/json,text/html,text/plain", "User-Agent": "ResearchGPT/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === 3) throw new Error("The selected source redirected too many times.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`The selected source returned HTTP ${response.status}.`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > input.maximumBytes) throw new Error("The selected source is too large.");
      const mediaType = response.headers.get("content-type")?.split(";")[0] ?? "text/plain";
      if (mediaType.includes("json")) {
        const work = JSON.parse(raw) as { display_name?: string; publication_year?: number; doi?: string; authorships?: Array<{ author?: { display_name?: string } }>; abstract_inverted_index?: Record<string, number[]> | null };
        const authors = (work.authorships ?? []).map((entry) => entry.author?.display_name).filter(Boolean).join(", ");
        return { finalUrl: current.toString(), title: work.display_name ?? "OpenAlex source", mediaType: "text/plain", text: [`Title: ${work.display_name ?? ""}`, `Authors: ${authors}`, `Year: ${work.publication_year ?? ""}`, `DOI: ${work.doi ?? ""}`, `Abstract: ${abstractFromIndex(work.abstract_inverted_index)}`].join("\n") };
      }
      const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.replace(/\s+/gu, " ").trim() ?? current.hostname;
      const text = raw.replace(/<script[\s\S]*?<\/script>/giu, " ").replace(/<style[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
      return { finalUrl: current.toString(), title, text, mediaType: "text/plain" };
    }
    throw new Error("Unable to fetch the selected source.");
  }
}
