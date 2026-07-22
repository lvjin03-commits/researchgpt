export const DESKTOP_STATUS_URL = "http://127.0.0.1:48732/status";
export const DESKTOP_SELECT_FOLDER_URL =
  "http://127.0.0.1:48732/local-folders/select";
export const DESKTOP_REFRESH_FOLDER_URL =
  "http://127.0.0.1:48732/local-folders/refresh";
export const DESKTOP_OPEN_FILE_URL = "http://127.0.0.1:48732/local-files/open";
export const DESKTOP_READ_FILE_URL = "http://127.0.0.1:48732/local-files/read";
export const DESKTOP_BINARY_FILE_URL =
  "http://127.0.0.1:48732/local-files/binary";
export const DESKTOP_CONNECT_URL = "researchgpt://connect";
export const DESKTOP_CONNECTOR_INSTALL_URL = "/local-connector";

export type DesktopConnectionState =
  | "checking"
  | "connected"
  | "permission_required"
  | "disconnected"
  | "connecting"
  | "failed"
  | "not_installed"
  | "version_mismatch";

export type DesktopConnectorCheck = {
  state: DesktopConnectionState;
  status: DesktopStatus | null;
  message?: string;
};

export type DesktopStatus = {
  online: boolean;
  app?: string;
  version?: string;
  userId?: string;
  deviceName?: string;
  capabilities?: string[];
  authorized?: boolean;
  state?: string;
  message?: string;
};

const REQUIRED_FILE_CAPABILITIES = [
  "open_file",
  "read_file_text",
  "read_file_binary",
];

export type LocalPdfFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  extension?: string;
  kind?: "pdf" | "word" | "excel" | "ppt" | "image" | "text" | "other";
  readable?: boolean;
};

export type LocalFolderBinding = {
  id: string;
  name: string;
  path: string;
  boundAt: string;
  pdfCount: number;
  fileCount?: number;
  truncated?: boolean;
  files: LocalPdfFile[];
};

export type LocalPdfTextResult = {
  filePath: string;
  name: string;
  pageCount: number;
  extension?: string;
  kind?: string;
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

type LocalFileBinaryResponse = {
  filePath?: unknown;
  name?: unknown;
  extension?: unknown;
  kind?: unknown;
  size?: unknown;
  fileBase64?: unknown;
  error?: unknown;
};

function normalizeConnectorState(value: unknown): DesktopConnectionState | null {
  if (typeof value !== "string") return null;
  if (
    value === "connected" ||
    value === "permission_required" ||
    value === "disconnected" ||
    value === "connecting" ||
    value === "failed" ||
    value === "not_installed" ||
    value === "version_mismatch"
  ) {
    return value;
  }
  if (value === "unauthorized") return "permission_required";
  if (value === "offline" || value === "starting") return "disconnected";
  return null;
}

function errorFromResponse(data: { error?: unknown }, fallback: string): Error {
  return new Error(typeof data.error === "string" ? data.error : fallback);
}

function hasRequiredFileCapabilities(status: {
  capabilities?: string[];
}): boolean {
  const capabilities = new Set(status.capabilities ?? []);
  return REQUIRED_FILE_CAPABILITIES.every((capability) =>
    capabilities.has(capability),
  );
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
    throw errorFromResponse(data, "本机连接器请求失败。");
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
    app: typeof data.app === "string" ? data.app : "ResearchGPT 本机连接器",
    version: typeof data.version === "string" ? data.version : undefined,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    deviceName:
      typeof data.deviceName === "string" ? data.deviceName : undefined,
    authorized:
      typeof data.authorized === "boolean" ? data.authorized : undefined,
    state: typeof data.state === "string" ? data.state : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter(
          (capability): capability is string =>
            typeof capability === "string" && capability.trim().length > 0,
        )
      : [],
  };
}

export async function inspectDesktopConnector(
  signal?: AbortSignal,
): Promise<DesktopConnectorCheck> {
  try {
    const response = await fetch(DESKTOP_STATUS_URL, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal,
    });

    let data: Partial<DesktopStatus> & { error?: unknown } = {};
    try {
      data = (await response.json()) as Partial<DesktopStatus> & {
        error?: unknown;
      };
    } catch {
      data = {};
    }

    const explicitState = normalizeConnectorState(data.state);
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : undefined;

    if (response.status === 401 || response.status === 403) {
      return { state: "permission_required", status: null, message };
    }

    if (!response.ok) {
      return {
        state: explicitState ?? "failed",
        status: null,
        message,
      };
    }

    if (explicitState && explicitState !== "connected") {
      return {
        state: explicitState,
        status: null,
        message,
      };
    }

    if (data.authorized === false) {
      return {
        state: "permission_required",
        status: null,
        message,
      };
    }

    if (data.online !== true) {
      return {
        state: explicitState ?? "disconnected",
        status: null,
        message,
      };
    }

    const status: DesktopStatus = {
      online: true,
      app: typeof data.app === "string" ? data.app : "ResearchGPT 本机连接器",
      version: typeof data.version === "string" ? data.version : undefined,
      userId: typeof data.userId === "string" ? data.userId : undefined,
      deviceName:
        typeof data.deviceName === "string" ? data.deviceName : undefined,
      authorized:
        typeof data.authorized === "boolean" ? data.authorized : undefined,
      state: typeof data.state === "string" ? data.state : undefined,
      message,
      capabilities: Array.isArray(data.capabilities)
        ? data.capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string" && capability.trim().length > 0,
          )
        : [],
    };

    if (!hasRequiredFileCapabilities(status)) {
      return {
        state: "version_mismatch",
        status,
        message: "本机连接器需要更新或重启，才能读取 Word、Excel、PPT 和图片等文件。",
      };
    }

    return { state: "connected", status, message };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return { state: "disconnected", status: null };
  }
}

export async function waitForDesktopConnector(
  delays = [900, 2200, 4200],
): Promise<DesktopConnectorCheck> {
  let latest: DesktopConnectorCheck = {
    state: "disconnected",
    status: null,
  };

  for (const delay of delays) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    latest = await inspectDesktopConnector();
    if (
      latest.state === "connected" ||
      latest.state === "permission_required" ||
      latest.state === "version_mismatch"
    ) {
      return latest;
    }
  }

  return { ...latest, state: latest.state === "connected" ? "connected" : "not_installed" };
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
    throw new Error("本机连接器返回的文件夹数据无效。");
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
          : folder.files.filter(
              (file) =>
                typeof file === "object" &&
                file !== null &&
                typeof (file as LocalPdfFile).name === "string" &&
                (file as LocalPdfFile).name.toLowerCase().endsWith(".pdf"),
            ).length,
      fileCount:
        typeof folder.fileCount === "number"
          ? folder.fileCount
          : folder.files.length,
      truncated: folder.truncated === true,
      files: folder.files
        .filter(
          (file): file is LocalPdfFile =>
            typeof file === "object" &&
            file !== null &&
            typeof (file as LocalPdfFile).id === "string" &&
            typeof (file as LocalPdfFile).name === "string" &&
            typeof (file as LocalPdfFile).path === "string" &&
            typeof (file as LocalPdfFile).size === "number" &&
            typeof (file as LocalPdfFile).modifiedAt === "string",
        )
        .map((file) => ({
          ...file,
          extension:
            typeof file.extension === "string" ? file.extension : undefined,
          kind:
            file.kind === "pdf" ||
            file.kind === "word" ||
            file.kind === "excel" ||
            file.kind === "ppt" ||
            file.kind === "image" ||
            file.kind === "text" ||
            file.kind === "other"
              ? file.kind
              : undefined,
          readable:
            typeof file.readable === "boolean" ? file.readable : undefined,
        })),
    },
  };
}

export async function refreshDesktopLocalFolder(
  folder: LocalFolderBinding,
  signal?: AbortSignal,
): Promise<LocalFolderBinding> {
  const data = await postJson<SelectLocalFolderResponse>(
    DESKTOP_REFRESH_FOLDER_URL,
    { path: folder.path, boundAt: folder.boundAt },
    signal,
  );

  const refreshedFolder = data.folder;
  if (
    !refreshedFolder ||
    typeof refreshedFolder.id !== "string" ||
    typeof refreshedFolder.name !== "string" ||
    typeof refreshedFolder.path !== "string" ||
    !Array.isArray(refreshedFolder.files)
  ) {
    throw new Error("本机连接器返回的刷新数据无效。");
  }

  return {
    id: refreshedFolder.id,
    name: refreshedFolder.name,
    path: refreshedFolder.path,
    boundAt:
      typeof refreshedFolder.boundAt === "string"
        ? refreshedFolder.boundAt
        : folder.boundAt,
    pdfCount:
      typeof refreshedFolder.pdfCount === "number"
        ? refreshedFolder.pdfCount
        : refreshedFolder.files.filter(
            (file) =>
              typeof file === "object" &&
              file !== null &&
              typeof (file as LocalPdfFile).name === "string" &&
              (file as LocalPdfFile).name.toLowerCase().endsWith(".pdf"),
          ).length,
    fileCount:
      typeof refreshedFolder.fileCount === "number"
        ? refreshedFolder.fileCount
        : refreshedFolder.files.length,
    truncated: refreshedFolder.truncated === true,
    files: refreshedFolder.files
      .filter(
        (file): file is LocalPdfFile =>
          typeof file === "object" &&
          file !== null &&
          typeof (file as LocalPdfFile).id === "string" &&
          typeof (file as LocalPdfFile).name === "string" &&
          typeof (file as LocalPdfFile).path === "string" &&
          typeof (file as LocalPdfFile).size === "number" &&
          typeof (file as LocalPdfFile).modifiedAt === "string",
      )
      .map((file) => ({
        ...file,
        extension:
          typeof file.extension === "string" ? file.extension : undefined,
        kind:
          file.kind === "pdf" ||
          file.kind === "word" ||
          file.kind === "excel" ||
          file.kind === "ppt" ||
          file.kind === "image" ||
          file.kind === "text" ||
          file.kind === "other"
            ? file.kind
            : undefined,
        readable:
          typeof file.readable === "boolean" ? file.readable : undefined,
      })),
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
    throw new Error("本机连接器返回的文件文本数据无效。");
  }

  return {
    filePath: data.filePath,
    name: data.name,
    pageCount: data.pageCount,
    extension: typeof data.extension === "string" ? data.extension : undefined,
    kind: typeof data.kind === "string" ? data.kind : undefined,
    text: data.text,
    charCount: data.charCount,
    truncated: data.truncated,
  };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function fetchDesktopLocalFileBlob(
  file: LocalPdfFile,
  signal?: AbortSignal,
): Promise<File> {
  const data = await postJson<LocalFileBinaryResponse>(
    DESKTOP_BINARY_FILE_URL,
    { path: file.path },
    signal,
  );

  if (typeof data.name !== "string" || typeof data.fileBase64 !== "string") {
    throw new Error("本机连接器返回的文件数据无效。");
  }

  return new File(
    [
      base64ToBlob(
        data.fileBase64,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ],
    data.name,
    {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );
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
