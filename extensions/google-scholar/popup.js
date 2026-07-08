const DEFAULT_BASE_URL = "http://localhost:3000";

const baseUrlInput = document.getElementById("baseUrl");
const saveSettingsButton = document.getElementById("saveSettings");
const loadFoldersButton = document.getElementById("loadFolders");
const foldersContainer = document.getElementById("folders");
const statusEl = document.getElementById("status");
const openScholarButton = document.getElementById("openScholar");
const openLibraryButton = document.getElementById("openLibrary");

function setStatus(message) {
  statusEl.textContent = message;
}

function getBaseUrl() {
  return (baseUrlInput.value || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.sync.get(defaults, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.sync.set(value, resolve));
}

async function loadSettings() {
  const settings = await storageGet({
    researchAiBaseUrl: DEFAULT_BASE_URL,
    researchAiFolderIds: [],
  });
  baseUrlInput.value = settings.researchAiBaseUrl || DEFAULT_BASE_URL;
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
      await storageSet({ researchAiFolderIds: ids });
      setStatus(`Selected ${ids.length} folder(s).`);
    });
  });
}

async function saveSettings() {
  await storageSet({ researchAiBaseUrl: getBaseUrl() });
  setStatus("Settings saved.");
}

async function loadFolders() {
  await saveSettings();
  const settings = await storageGet({ researchAiFolderIds: [] });
  setStatus("Loading folders...");

  try {
    const response = await fetch(`${getBaseUrl()}/api/literature/folders`, {
      credentials: "include",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `ResearchAI returned ${response.status}`);
    }

    renderFolders(payload.folders || [], settings.researchAiFolderIds || []);
    setStatus("Folders loaded.");
  } catch (error) {
    setStatus(
      `Could not load folders. Open ResearchAI and sign in first. ${error.message || ""}`,
    );
  }
}

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

void loadSettings();
