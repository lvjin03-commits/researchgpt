export const DESKTOP_STATUS_URL = "http://127.0.0.1:48732/status";
export const DESKTOP_SELECT_FOLDER_URL =
  "http://127.0.0.1:48732/local-folders/select";
export const DESKTOP_OPEN_FILE_URL = "http://127.0.0.1:48732/local-files/open";
export const DESKTOP_READ_FILE_URL = "http://127.0.0.1:48732/local-files/read";
export const DESKTOP_CONNECT_URL = "researchgpt://connect";

export type DesktopConnectionState =
  | "checking"
  | "connected"
  | "disconnected"
  | "connecting"
  | "failed";

export type DesktopStatus = {
  online: boolean;
  app?: string;
  version?: string;
  userId?: string;
  deviceName?: string;
  capabilities?: string[];
};

export type LocalPdfFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
};

export type LocalFolderBinding = {
  id: string;
  name: string;
  path: string;
  boundAt: string;
  pdfCount: number;
  truncated?: boolean;
  files: LocalPdfFile[];
};

export type LocalPdfTextResult = {
  filePath: string;
  name: string;
  pageCount: number;
  text: string;
  charCount: number;
  truncated: boolean;
};

export type SelectLocalFolderResult =
  | { canceled: true }
  | { canceled: false; folder: LocalFolderBinding };

type SelectLocalFolderResponse = {
  canceled?: boolean;
  folder?: Partial<LocalFolderBinding> & { files?: unknown[] };
  error?: unknown;
};

type LocalPdfTextResponse = Partial<LocalPdfTextResult> & {
  error?: unknown;
};

function errorFromResponse(data: { error?: unknown }, fallback: string): Error {
  return new Error(typeof data.error === "string" ? data.error : fallback);
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    throw errorFromResponse(data, "Desktop request failed.");
  }
  return data;
}

export async function fetchDesktopStatus(
  signal?: AbortSignal,
): Promise<DesktopStatus | null> {
  const response = await fetch(DESKTOP_STATUS_URL, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    signal,
  });

  if (!response.ok) return null;

  const data = (await response.json()) as Partial<DesktopStatus>;
  if (data.online !== true) return null;

  return {
    online: true,
    app: typeof data.app === "string" ? data.app : "ResearchGPT Desktop",
    version: typeof data.version === "string" ? data.version : undefined,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    deviceName:
      typeof data.deviceName === "string" ? data.deviceName : undefined,
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter(
          (capability): capability is string =>
            typeof capability === "string" && capability.trim().length > 0,
        )
      : [],
  };
}

export async function selectDesktopLocalFolder(
  signal?: AbortSignal,
): Promise<SelectLocalFolderResult> {
  const data = await postJson<SelectLocalFolderResponse>(
    DESKTOP_SELECT_FOLDER_URL,
    {},
    signal,
  );

  if (data.canceled === true) {
    return { canceled: true };
  }

  const folder = data.folder;
  if (
    !folder ||
    typeof folder.id !== "string" ||
    typeof folder.name !== "string" ||
    typeof folder.path !== "string" ||
    !Array.isArray(folder.files)
  ) {
    throw new Error("Desktop returned invalid folder data.");
  }

  return {
    canceled: false,
    folder: {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      boundAt:
        typeof folder.boundAt === "string"
          ? folder.boundAt
          : new Date().toISOString(),
      pdfCount:
        typeof folder.pdfCount === "number"
          ? folder.pdfCount
          : folder.files.length,
      truncated: folder.truncated === true,
      files: folder.files.filter(
        (file): file is LocalPdfFile =>
          typeof file === "object" &&
          file !== null &&
          typeof (file as LocalPdfFile).id === "string" &&
          typeof (file as LocalPdfFile).name === "string" &&
          typeof (file as LocalPdfFile).path === "string" &&
          typeof (file as LocalPdfFile).size === "number" &&
          typeof (file as LocalPdfFile).modifiedAt === "string",
      ),
    },
  };
}

export async function openDesktopLocalPdf(
  file: LocalPdfFile,
  signal?: AbortSignal,
): Promise<void> {
  await postJson<{ opened?: boolean }>(
    DESKTOP_OPEN_FILE_URL,
    { path: file.path },
    signal,
  );
}

export async function readDesktopLocalPdf(
  file: LocalPdfFile,
  signal?: AbortSignal,
): Promise<LocalPdfTextResult> {
  const data = await postJson<LocalPdfTextResponse>(
    DESKTOP_READ_FILE_URL,
    { path: file.path, limit: 160000 },
    signal,
  );

  if (
    typeof data.filePath !== "string" ||
    typeof data.name !== "string" ||
    typeof data.pageCount !== "number" ||
    typeof data.text !== "string" ||
    typeof data.charCount !== "number" ||
    typeof data.truncated !== "boolean"
  ) {
    throw new Error("Desktop returned invalid PDF text data.");
  }

  return {
    filePath: data.filePath,
    name: data.name,
    pageCount: data.pageCount,
    text: data.text,
    charCount: data.charCount,
    truncated: data.truncated,
  };
}

export function launchDesktopConnect(): void {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = DESKTOP_CONNECT_URL;
  document.body.appendChild(iframe);

  window.setTimeout(() => {
    iframe.remove();
  }, 1500);
}
