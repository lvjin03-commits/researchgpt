const DEFAULT_BASE_URL = "http://localhost:3000";

const STORAGE_KEYS = {
  authToken: "researchAiAuthToken",
  baseUrl: "researchAiBaseUrl",
  folderIds: "researchAiFolderIds",
  lastSaveStatus: "researchAiLastSaveStatus",
};

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

async function savePaperToBackend(paper) {
  const config = await getConfig();
  const baseUrl = String(config[STORAGE_KEYS.baseUrl] || DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const authToken = String(config[STORAGE_KEYS.authToken] || "").trim();
  const folderIds = Array.isArray(config[STORAGE_KEYS.folderIds])
    ? config[STORAGE_KEYS.folderIds]
    : [];

  if (!authToken) {
    throw new Error("Missing auth token. Open the extension popup and paste your token.");
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_PAPER") {
    return false;
  }

  void (async () => {
    try {
      const payload = await savePaperToBackend(message.paper);
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
