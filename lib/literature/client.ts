// Client-only module.

import { LiteratureError } from "@/lib/literature/errors";
import type {
  LiteraturePaper,
  LiteratureSettings,
  UpdateLiteratureResponse,
} from "@/lib/literature/types";

export { LiteratureError };

export type LiteratureState = {
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
};

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new LiteratureError("Invalid literature API response.", response.status);
  }
}

export async function fetchLiteratureState(): Promise<LiteratureState> {
  const response = await fetch("/api/literature");

  const payload = await parseJson<LiteratureState & { error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load literature tracker.",
      response.status,
    );
  }

  return {
    settings: payload.settings,
    papers: payload.papers ?? [],
  };
}

export async function saveLiteratureSettings(
  settings: LiteratureSettings,
): Promise<LiteratureSettings> {
  const response = await fetch("/api/literature", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  const payload = await parseJson<{ settings: LiteratureSettings; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to save literature settings.",
      response.status,
    );
  }

  return payload.settings;
}

export async function updateLiteraturePapers(
  settings: LiteratureSettings,
): Promise<UpdateLiteratureResponse> {
  const response = await fetch("/api/literature/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  const payload = await parseJson<UpdateLiteratureResponse & { error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update literature papers.",
      response.status,
    );
  }

  return payload;
}

export async function fetchLiteraturePaper(paperId: string): Promise<LiteraturePaper> {
  const response = await fetch(`/api/literature/papers/${paperId}`);

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load literature paper.",
      response.status,
    );
  }

  return payload.paper;
}

export async function updateLiteraturePaperStatus(
  paperId: string,
  status: "saved" | "skipped" | "read",
): Promise<LiteraturePaper> {
  const response = await fetch(`/api/literature/papers/${paperId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update paper status.",
      response.status,
    );
  }

  return payload.paper;
}
