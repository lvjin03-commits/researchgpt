const DEFAULT_BASE_URL = "https://researchgpt-ivory.vercel.app";

const STORAGE_KEYS = {
  authToken: "researchAiAuthToken",
  baseUrl: "researchAiBaseUrl",
  folderIds: "researchAiFolderIds",
  lastSaveStatus: "researchAiLastSaveStatus",
};

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

async function savePaperToBackend(paper) {
  return savePaperToBackendWithFolders(paper, undefined);
}

async function savePaperToBackendWithFolders(paper, selectedFolderIds) {
  const config = await getConfig();
  const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
  const authToken = String(config[STORAGE_KEYS.authToken] || "").trim();
  const folderIds = Array.isArray(selectedFolderIds)
    ? selectedFolderIds
    : Array.isArray(config[STORAGE_KEYS.folderIds])
    ? config[STORAGE_KEYS.folderIds]
    : [];

  if (!authToken) {
    throw new Error(
      "Missing auth token. Open the extension popup and click Connect account.",
    );
  }

  const response = await fetch(`${baseUrl}/api/extension/save-paper`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ paper, folderIds }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `ResearchAI returned ${response.status}`);
  }

  return payload;
}

async function loadFoldersFromBackend() {
  const config = await getConfig();
  const baseUrl = normalizeBaseUrl(config[STORAGE_KEYS.baseUrl]);
  const authToken = String(config[STORAGE_KEYS.authToken] || "").trim();
  const selectedFolderIds = Array.isArray(config[STORAGE_KEYS.folderIds])
    ? config[STORAGE_KEYS.folderIds]
    : [];

  if (!authToken) {
    throw new Error(
      "Missing auth token. Open the extension popup and click Connect account.",
    );
  }

  const response = await fetch(`${baseUrl}/api/extension/folders`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `ResearchAI returned ${response.status}`);
  }

  return {
    folders: Array.isArray(payload.folders) ? payload.folders : [],
    selectedFolderIds,
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
          error: error instanceof Error ? error.message : "Could not load folders.",
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
      });
    }
  })();

  return true;
});
