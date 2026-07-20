const DEFAULT_BASE_URL = "https://researchgpt-ivory.vercel.app";

const STORAGE_KEYS = {
  authToken: "researchAiAuthToken",
  baseUrl: "researchAiBaseUrl",
  folderIds: "researchAiFolderIds",
  lastSaveStatus: "researchAiLastSaveStatus",
};

class ManualUploadRequiredError extends Error {
  constructor(message, pdfUrl) {
    super(message);
    this.name = "ManualUploadRequiredError";
    this.manualUploadRequired = true;
    this.pdfUrl = pdfUrl || "";
  }
}

const RECONNECT_MESSAGE =
  "登录状态已失效。请先登录 ResearchGPT 网站，再打开插件点击 Connect account（连接账户），然后点击 Load folders（加载文件夹）后重试。";

function responseErrorMessage(response, payload) {
  if (response.status === 401) {
    return RECONNECT_MESSAGE;
  }

  return payload?.error || `ResearchGPT returned ${response.status}`;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).replace(/\/$/, "");

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return DEFAULT_BASE_URL;
    }
  } catch {
    return DEFAULT_BASE_URL;
  }

  return raw;
}

function storageGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

async function getConfig() {
  return storageGet({
    [STORAGE_KEYS.authToken]: "",
    [STORAGE_KEYS.baseUrl]: DEFAULT_BASE_URL,
    [STORAGE_KEYS.folderIds]: [],
  });
}

async function saveAuthToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) {
    return false;
  }

  await storageSet({ [STORAGE_KEYS.authToken]: token });
  return true;
}

function readJwtExpiresAt(token) {
  try {
    const payloadPart = String(token || "").split(".")[1];
    if (!payloadPart) {
      return null;
    }

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshAuthToken(baseUrl) {
  const response = await fetch(`${baseUrl}/api/extension/session`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.accessToken) {
    await storageSet({ [STORAGE_KEYS.authToken]: "" });
    throw new Error(
      response.status === 401
        ? RECONNECT_MESSAGE
        : payload.error || `ResearchGPT returned ${response.status}`,
    );
  }

  await saveAuthToken(payload.accessToken);
  return payload.accessToken;
}

async function getUsableAuthToken(baseUrl, storedToken, forceRefresh = false) {
  const token = String(storedToken || "").trim();
  const expiresAt = readJwtExpiresAt(token);
  const expiresSoon = expiresAt !== null && expiresAt <= Date.now() + 60_000;

  if (forceRefresh || !token || expiresSoon) {
    return refreshAuthToken(baseUrl);
  }

  return token;
}

async function savePaperToBackend(paper) {
  return savePaperToBackendWithFolders(paper, undefined);
}

function sanitizeFilePart(value) {
  return (
    String(value || "paper")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "paper"
  );
}

function fileNameFromPaper(paper) {
  try {
    const url = new URL(paper?.pdfUrl || "");
    const pathName = decodeURIComponent(url.pathname.split("/").pop() || "");
    if (pathName.toLowerCase().endsWith(".pdf")) {
      return sanitizeFilePart(pathName);
    }
  } catch {
    // Fall back to the paper title below.
  }

  return `${sanitizeFilePart(paper?.title)}.pdf`;
}

function openPdfForManualDownload(pdfUrl) {
  const url = String(pdfUrl || "").trim();

  if (!url) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, () => {
      resolve();
    });
  });
}

async function downloadPdfFromBrowser(paper) {
  const pdfUrl = String(paper?.pdfUrl || "").trim();

  if (!pdfUrl) {
    throw new Error("No direct PDF link was detected.");
  }

  const response = await fetch(pdfUrl, {
    credentials: "include",
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`PDF download failed in Chrome: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const arrayBuffer = await response.arrayBuffer();

  if (!arrayBuffer.byteLength) {
    throw new Error("Downloaded PDF is empty.");
  }

  const header = new TextDecoder().decode(
    new Uint8Array(arrayBuffer.slice(0, 5)),
  );

  if (header !== "%PDF-" && !contentType.includes("pdf")) {
    throw new Error("Downloaded file is not a PDF.");
  }

  return new Blob([arrayBuffer], { type: "application/pdf" });
}

async function savePaperToBackendWithFolders(paper, selectedFolderIds) {
  const config = await getConfig();
  const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
  let authToken = await getUsableAuthToken(
    baseUrl,
    config[STORAGE_KEYS.authToken],
  );
  const folderIds = Array.isArray(selectedFolderIds)
    ? selectedFolderIds
    : Array.isArray(config[STORAGE_KEYS.folderIds])
    ? config[STORAGE_KEYS.folderIds]
    : [];

  let pdfBlob;
  try {
    pdfBlob = await downloadPdfFromBrowser(paper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PDF automatic download failed.";
    await openPdfForManualDownload(paper?.pdfUrl);
    throw new ManualUploadRequiredError(
      `Automatic PDF download was blocked: ${message}. Download the PDF in the opened tab, then upload it here.`,
      paper?.pdfUrl,
    );
  }

  const formData = new FormData();
  formData.append("paper", JSON.stringify(paper));
  formData.append("folderIds", JSON.stringify(folderIds));
  formData.append("file", pdfBlob, fileNameFromPaper(paper));

  let response = await fetch(`${baseUrl}/api/extension/upload-paper`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });

  if (response.status === 401) {
    authToken = await getUsableAuthToken(baseUrl, authToken, true);
    response = await fetch(`${baseUrl}/api/extension/upload-paper`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseErrorMessage(response, payload));
  }

  return payload;
}

async function loadFoldersFromBackend() {
  const config = await getConfig();
  const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
  let authToken = await getUsableAuthToken(
    baseUrl,
    config[STORAGE_KEYS.authToken],
  );
  const selectedFolderIds = Array.isArray(config[STORAGE_KEYS.folderIds])
    ? config[STORAGE_KEYS.folderIds]
    : [];

  let response = await fetch(`${baseUrl}/api/extension/folders`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (response.status === 401) {
    authToken = await getUsableAuthToken(baseUrl, authToken, true);
    response = await fetch(`${baseUrl}/api/extension/folders`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseErrorMessage(response, payload));
  }

  return {
    folders: Array.isArray(payload.folders) ? payload.folders : [],
    selectedFolderIds,
  };
}

async function getUploadConfig() {
  const config = await getConfig();
  const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
  const authToken = await getUsableAuthToken(
    baseUrl,
    config[STORAGE_KEYS.authToken],
  );

  return {
    baseUrl,
    authToken,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AUTH_TOKEN") {
    void (async () => {
      const saved = await saveAuthToken(message.accessToken);
      sendResponse({ ok: saved });
    })();
    return true;
  }

  if (message?.type === "GET_FOLDERS") {
    void (async () => {
      try {
        const payload = await loadFoldersFromBackend();
        sendResponse({ ok: true, ...payload });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Could not load folders.",
        });
      }
    })();
    return true;
  }

  if (message?.type === "GET_UPLOAD_CONFIG") {
    void (async () => {
      try {
        const payload = await getUploadConfig();
        sendResponse({ ok: true, ...payload });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not prepare PDF upload.",
        });
      }
    })();
    return true;
  }

  if (message?.type === "REFRESH_AUTH_TOKEN") {
    void (async () => {
      try {
        const config = await getConfig();
        const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
        const authToken = await refreshAuthToken(baseUrl);
        sendResponse({ ok: true, baseUrl, authToken });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not refresh your login.",
        });
      }
    })();
    return true;
  }

  if (message?.type !== "SAVE_PAPER") {
    return false;
  }

  void (async () => {
    try {
      const payload = await savePaperToBackendWithFolders(
        message.paper,
        message.folderIds,
      );
      const saved = payload.saved || null;
      const status = {
        ok: true,
        title: saved?.title || message.paper?.title || "Paper",
        savedAt: new Date().toISOString(),
        message: `Saved "${saved?.title || message.paper?.title || "paper"}" to your library.`,
      };

      await storageSet({ [STORAGE_KEYS.lastSaveStatus]: status });
      sendResponse({ ok: true, ...payload });
    } catch (error) {
      const manualUploadRequired = error?.manualUploadRequired === true;
      const status = {
        ok: false,
        title: message.paper?.title || "Paper",
        savedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Save failed.",
      };

      await storageSet({ [STORAGE_KEYS.lastSaveStatus]: status });
      sendResponse({
        ok: false,
        error: status.message,
        manualUploadRequired,
        pdfUrl: manualUploadRequired
          ? error.pdfUrl || message.paper?.pdfUrl || ""
          : "",
      });
    }
  })();

  return true;
});
