const DEFAULT_BASE_URL = "http://localhost:3000";

const STORAGE_KEYS = {
  authToken: "researchAiAuthToken",
  baseUrl: "researchAiBaseUrl",
  folderIds: "researchAiFolderIds",
  lastSaveStatus: "researchAiLastSaveStatus",
};

const baseUrlInput = document.getElementById("baseUrl");
const authTokenInput = document.getElementById("authToken");
const connectAccountButton = document.getElementById("connectAccount");
const saveSettingsButton = document.getElementById("saveSettings");
const loadFoldersButton = document.getElementById("loadFolders");
const foldersContainer = document.getElementById("folders");
const statusEl = document.getElementById("status");
const saveStatusEl = document.getElementById("saveStatus");
const openScholarButton = document.getElementById("openScholar");
const openLibraryButton = document.getElementById("openLibrary");

function setStatus(message) {
  statusEl.textContent = message;
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

function getBaseUrl() {
  return (baseUrlInput.value || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getAuthToken() {
  return authTokenInput.value.trim();
}

async function loadSettings() {
  const settings = await storageGet({
    [STORAGE_KEYS.authToken]: "",
    [STORAGE_KEYS.baseUrl]: DEFAULT_BASE_URL,
    [STORAGE_KEYS.folderIds]: [],
    [STORAGE_KEYS.lastSaveStatus]: null,
  });

  baseUrlInput.value = settings[STORAGE_KEYS.baseUrl] || DEFAULT_BASE_URL;
  authTokenInput.value = settings[STORAGE_KEYS.authToken] || "";
  renderSaveStatus(settings[STORAGE_KEYS.lastSaveStatus]);
}

function renderSaveStatus(status) {
  if (!status || typeof status !== "object") {
    saveStatusEl.textContent = "No saves yet.";
    saveStatusEl.className = "status muted";
    return;
  }

  const savedAt =
    typeof status.savedAt === "string"
      ? new Date(status.savedAt).toLocaleString()
      : "";
  const message =
    typeof status.message === "string" ? status.message : "Save completed.";

  saveStatusEl.textContent = savedAt ? `${message} (${savedAt})` : message;
  saveStatusEl.className = status.ok ? "status success" : "status error";
}

function renderFolders(folders, selectedIds) {
  if (!folders.length) {
    foldersContainer.innerHTML = '<div class="muted">No folders found.</div>';
    return;
  }

  foldersContainer.innerHTML = folders
    .map(
      (folder) => `
        <label class="folder">
          <input type="checkbox" value="${folder.id}" ${
            selectedIds.includes(folder.id) ? "checked" : ""
          }>
          <span>${folder.name}</span>
        </label>
      `,
    )
    .join("");

  foldersContainer.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", async () => {
      const ids = Array.from(
        foldersContainer.querySelectorAll("input[type='checkbox']:checked"),
      ).map((item) => item.value);
      await storageSet({ [STORAGE_KEYS.folderIds]: ids });
      setStatus(`Selected ${ids.length} folder(s).`);
    });
  });
}

async function saveSettings() {
  await storageSet({
    [STORAGE_KEYS.baseUrl]: getBaseUrl(),
    [STORAGE_KEYS.authToken]: getAuthToken(),
  });
  setStatus("Settings saved.");
}

async function connectAccount() {
  await saveSettings();
  const baseUrl = getBaseUrl();

  setStatus("Connecting...");

  try {
    const response = await fetch(`${baseUrl}/api/extension/session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));

    if (response.ok && payload.accessToken) {
      authTokenInput.value = payload.accessToken;
      await storageSet({ [STORAGE_KEYS.authToken]: payload.accessToken });
      setStatus("Connected. You can load folders now.");
      return;
    }

    if (response.status === 401) {
      chrome.tabs.create({
        url: `${baseUrl}/auth?next=${encodeURIComponent("/extension/connect")}`,
      });
      setStatus("Sign in opened in a new tab. After login, click Connect account again.");
      return;
    }

    throw new Error(payload.error || `ResearchAI returned ${response.status}`);
  } catch (error) {
    setStatus(
      `Could not connect. Sign in at ${baseUrl} first. ${error.message || ""}`,
    );
  }
}

async function loadFolders() {
  await saveSettings();
  const settings = await storageGet({ [STORAGE_KEYS.folderIds]: [] });
  const authToken = getAuthToken();

  if (!authToken) {
    setStatus("Click Connect account first.");
    return;
  }

  setStatus("Loading folders...");

  try {
    const response = await fetch(`${getBaseUrl()}/api/extension/folders`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `ResearchAI returned ${response.status}`);
    }

    renderFolders(payload.folders || [], settings[STORAGE_KEYS.folderIds] || []);
    setStatus("Folders loaded.");
  } catch (error) {
    setStatus(
      `Could not load folders. Check your URL and token. ${error.message || ""}`,
    );
  }
}

connectAccountButton.addEventListener("click", () => {
  void connectAccount();
});

saveSettingsButton.addEventListener("click", () => {
  void saveSettings();
});

loadFoldersButton.addEventListener("click", () => {
  void loadFolders();
});

openScholarButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://scholar.google.com/" });
});

openLibraryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: `${getBaseUrl()}/literature/library` });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.authToken]?.newValue) {
    authTokenInput.value = String(changes[STORAGE_KEYS.authToken].newValue);
    setStatus("Auth token updated from connect page.");
  }

  if (changes[STORAGE_KEYS.lastSaveStatus]) {
    renderSaveStatus(changes[STORAGE_KEYS.lastSaveStatus].newValue);
  }
});

void loadSettings();
