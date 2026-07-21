export const DESKTOP_STATUS_URL = "http://127.0.0.1:48732/status";
export const DESKTOP_SELECT_FOLDER_URL =
  "http://127.0.0.1:48732/local-folders/select";
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

export type SelectLocalFolderResult =
  | { canceled: true }
  | { canceled: false; folder: LocalFolderBinding };

type SelectLocalFolderResponse = {
  canceled?: boolean;
  folder?: Partial<LocalFolderBinding> & { files?: unknown[] };
  error?: unknown;
};

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
  const response = await fetch(DESKTOP_SELECT_FOLDER_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    signal,
  });

  const data = (await response.json()) as SelectLocalFolderResponse;

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "本地文件夹绑定失败",
    );
  }

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
    throw new Error("本机返回的文件夹信息无效");
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

export function launchDesktopConnect(): void {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = DESKTOP_CONNECT_URL;
  document.body.appendChild(iframe);

  window.setTimeout(() => {
    iframe.remove();
  }, 1500);
}
