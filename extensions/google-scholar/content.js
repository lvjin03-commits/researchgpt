(function () {
  const BUTTON_SELECTOR = "[data-researchai-save]";
  const RESULT_SELECTOR = ".gs_r.gs_or.gs_scl";
  const MODAL_SELECTOR = "[data-researchai-folder-modal]";
  const MANUAL_UPLOAD_MODAL_SELECTOR = "[data-researchai-manual-upload-modal]";
  const NO_PDF_MESSAGE =
    "No direct PDF link was detected. Upload the PDF from your literature library when needed.";

  function text(element) {
    return element ? element.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function parseYear(value) {
    const match = value.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : "";
  }

  function parseAuthors(meta) {
    const firstSegment = meta.split(" - ")[0] || "";
    return firstSegment
      .replace(/\bet al\.?/gi, "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseCitedBy(container) {
    const anchors = Array.from(container.querySelectorAll("a"));
    const cited = anchors.find((anchor) => /^Cited by\s+\d+/i.test(text(anchor)));
    if (!cited) {
      return null;
    }

    const count = Number(text(cited).replace(/\D/g, ""));
    return Number.isFinite(count) ? count : null;
  }

  function isLikelyPdfLink(anchor) {
    const href = anchor.href.toLowerCase();
    const label = text(anchor).toLowerCase();

    return (
      label.includes("pdf") ||
      href.endsWith(".pdf") ||
      href.includes(".pdf?") ||
      href.includes("/pdf/") ||
      href.includes("pdf")
    );
  }

  function parsePdfUrl(container) {
    const sideLink = container.querySelector(".gs_or_ggsm a");

    if (sideLink instanceof HTMLAnchorElement && isLikelyPdfLink(sideLink)) {
      return sideLink.href;
    }

    return "";
  }

  function parsePaperFromContainer(container) {
    const titleAnchor = container.querySelector(".gs_rt a");
    const titleNode = titleAnchor || container.querySelector(".gs_rt");
    const title = text(titleNode).replace(/^\[[^\]]+\]\s*/, "");
    const url = titleAnchor instanceof HTMLAnchorElement ? titleAnchor.href : "";
    const meta = text(container.querySelector(".gs_a"));
    const snippet = text(container.querySelector(".gs_rs"));

    if (!title || !url) {
      return null;
    }

    return {
      title,
      url,
      authors: parseAuthors(meta),
      venue: meta,
      year: parseYear(meta),
      snippet,
      pdfUrl: parsePdfUrl(container),
      citedByCount: parseCitedBy(container),
    };
  }

  function setButtonState(button, state, message) {
    button.dataset.researchaiState = state;
    button.disabled = state === "saving" || state === "saved" || state === "no-pdf";

    if (state === "idle") {
      button.textContent = "Save PDF to ResearchGPT";
      button.title = "";
      return;
    }

    if (state === "saving") {
      button.textContent = "Saving PDF...";
      button.title = "Saving PDF to ResearchGPT";
      return;
    }

    if (state === "saved") {
      button.textContent = "PDF saved";
      button.title = message || "Saved to ResearchGPT";
      return;
    }

    if (state === "no-pdf") {
      button.textContent = "No PDF link";
      button.title = message || NO_PDF_MESSAGE;
      return;
    }

    button.textContent = "Retry save";
    button.title = message || "Save failed";
  }

  function closeFolderModal() {
    document.querySelector(MODAL_SELECTOR)?.remove();
  }

  function closeManualUploadModal() {
    document.querySelector(MANUAL_UPLOAD_MODAL_SELECTOR)?.remove();
  }

  function createFolderOption(folder, checked) {
    const label = document.createElement("label");
    label.className = "researchai-folder-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = folder.id;
    input.checked = checked;

    const name = document.createElement("span");
    name.textContent = folder.name || "Untitled folder";

    label.appendChild(input);
    label.appendChild(name);
    return label;
  }

  function chooseFolders() {
    return new Promise((resolve, reject) => {
      closeFolderModal();

      chrome.runtime.sendMessage({ type: "GET_FOLDERS" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Could not load folders."));
          return;
        }

        const folders = Array.isArray(response.folders) ? response.folders : [];
        const selectedFolderIds = Array.isArray(response.selectedFolderIds)
          ? response.selectedFolderIds
          : [];

        if (!folders.length) {
          reject(new Error("No folders found. Create a folder in ResearchGPT first."));
          return;
        }

        const overlay = document.createElement("div");
        overlay.className = "researchai-folder-overlay";
        overlay.dataset.researchaiFolderModal = "1";

        const panel = document.createElement("div");
        panel.className = "researchai-folder-panel";

        const title = document.createElement("h2");
        title.textContent = "Save PDF to folder";

        const description = document.createElement("p");
        description.textContent = "Choose one or more ResearchGPT folders for this paper.";

        const list = document.createElement("div");
        list.className = "researchai-folder-list";

        folders.forEach((folder) => {
          list.appendChild(
            createFolderOption(folder, selectedFolderIds.includes(folder.id)),
          );
        });

        const error = document.createElement("div");
        error.className = "researchai-folder-error";

        const actions = document.createElement("div");
        actions.className = "researchai-folder-actions";

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "researchai-folder-cancel";
        cancel.textContent = "Cancel";

        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "researchai-folder-confirm";
        confirm.textContent = "Save PDF";

        cancel.addEventListener("click", () => {
          closeFolderModal();
          resolve(null);
        });

        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) {
            closeFolderModal();
            resolve(null);
          }
        });

        confirm.addEventListener("click", () => {
          const folderIds = Array.from(
            list.querySelectorAll("input[type='checkbox']:checked"),
          ).map((input) => input.value);

          if (!folderIds.length) {
            error.textContent = "Please choose at least one folder.";
            return;
          }

          closeFolderModal();
          resolve(folderIds);
        });

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(list);
        panel.appendChild(error);
        panel.appendChild(actions);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
      });
    });
  }

  function getUploadConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "GET_UPLOAD_CONFIG" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Could not prepare upload."));
          return;
        }

        resolve(response);
      });
    });
  }

  async function uploadManualPdf(paper, folderIds, file) {
    if (!file) {
      throw new Error("Please choose a PDF file.");
    }

    const fileName = String(file.name || "").toLowerCase();
    const fileType = String(file.type || "").toLowerCase();
    if (!fileName.endsWith(".pdf") && !fileType.includes("pdf")) {
      throw new Error("Please choose a PDF file.");
    }

    const config = await getUploadConfig();
    const formData = new FormData();
    formData.append("paper", JSON.stringify(paper));
    formData.append("folderIds", JSON.stringify(folderIds));
    formData.append("file", file, file.name || "paper.pdf");

    const response = await fetch(`${config.baseUrl}/api/extension/upload-paper`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.authToken}`,
      },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `ResearchGPT returned ${response.status}`);
    }

    return payload;
  }

  function showManualUploadDialog(paper, folderIds, button, reason) {
    closeManualUploadModal();
    let selectedFile = null;

    const overlay = document.createElement("div");
    overlay.className = "researchai-folder-overlay";
    overlay.dataset.researchaiManualUploadModal = "1";

    const panel = document.createElement("div");
    panel.className = "researchai-folder-panel researchai-upload-panel";

    const title = document.createElement("h2");
    title.textContent = "Upload downloaded PDF";

    const description = document.createElement("p");
    description.textContent =
      "Automatic download was blocked. Finish downloading the PDF in the opened tab first, then come back here and choose that exact file.";

    const paperTitle = document.createElement("div");
    paperTitle.className = "researchai-upload-paper";
    paperTitle.textContent = paper.title || "Untitled paper";

    const detail = document.createElement("p");
    detail.className = "researchai-upload-detail";
    detail.textContent = reason || "";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.className = "researchai-upload-input";
    input.hidden = true;

    const fileStatus = document.createElement("div");
    fileStatus.className = "researchai-upload-file-status";
    fileStatus.textContent = "No PDF selected yet.";

    const error = document.createElement("div");
    error.className = "researchai-folder-error";

    const actions = document.createElement("div");
    actions.className = "researchai-folder-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "researchai-folder-cancel";
    cancel.textContent = "Cancel";

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "researchai-folder-cancel";
    choose.textContent = "Choose downloaded PDF";

    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "researchai-folder-confirm";
    upload.textContent = "Upload PDF";
    upload.disabled = true;

    cancel.addEventListener("click", () => {
      closeManualUploadModal();
      setButtonState(button, "error", "Manual PDF upload was cancelled.");
    });

    choose.addEventListener("click", () => {
      error.textContent = "";
      input.click();
    });

    input.addEventListener("change", () => {
      selectedFile = input.files?.[0] || null;

      if (!selectedFile) {
        upload.disabled = true;
        fileStatus.textContent = "No PDF selected yet.";
        return;
      }

      const fileName = String(selectedFile.name || "");
      const fileType = String(selectedFile.type || "").toLowerCase();
      const isPdf = fileName.toLowerCase().endsWith(".pdf") || fileType.includes("pdf");

      upload.disabled = !isPdf;
      fileStatus.textContent = isPdf
        ? `Selected: ${fileName}`
        : "Selected file is not a PDF. Please choose the downloaded PDF.";
    });

    upload.addEventListener("click", () => {
      void (async () => {
        try {
          upload.disabled = true;
          choose.disabled = true;
          cancel.disabled = true;
          upload.textContent = "Uploading...";
          error.textContent = "";
          setButtonState(button, "saving", "Uploading selected PDF...");

          const payload = await uploadManualPdf(paper, folderIds, selectedFile);
          closeManualUploadModal();
          setButtonState(
            button,
            "saved",
            payload.saved?.title
              ? `Saved "${payload.saved.title}"`
              : "Saved to ResearchGPT",
          );
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload failed.";
          upload.disabled = !selectedFile;
          choose.disabled = false;
          cancel.disabled = false;
          upload.textContent = "Upload PDF";
          error.textContent = message;
          setButtonState(button, "error", message);
        }
      })();
    });

    actions.appendChild(cancel);
    actions.appendChild(choose);
    actions.appendChild(upload);
    panel.appendChild(title);
    panel.appendChild(description);
    panel.appendChild(paperTitle);
    if (detail.textContent) {
      panel.appendChild(detail);
    }
    panel.appendChild(input);
    panel.appendChild(fileStatus);
    panel.appendChild(error);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  async function savePaper(container, button) {
    const paper = parsePaperFromContainer(container);
    if (!paper) {
      setButtonState(button, "error", "Could not read this result.");
      return;
    }

    if (!paper.pdfUrl) {
      setButtonState(button, "no-pdf", NO_PDF_MESSAGE);
      window.alert(NO_PDF_MESSAGE);
      return;
    }

    try {
      const folderIds = await chooseFolders();
      if (!folderIds) {
        setButtonState(button, "idle");
        return;
      }

      setButtonState(button, "saving");

      const response = await chrome.runtime.sendMessage({
        type: "SAVE_PAPER",
        paper,
        folderIds,
      });

      if (!response?.ok) {
        if (response?.manualUploadRequired) {
          setButtonState(button, "error", "Manual PDF upload required.");
          showManualUploadDialog(paper, folderIds, button, response.error);
          return;
        }

        throw new Error(response?.error || "Save failed.");
      }

      setButtonState(
        button,
        "saved",
        response.saved?.title
          ? `Saved "${response.saved.title}"`
          : "Saved to ResearchGPT",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setButtonState(
        button,
        "error",
        message,
      );
      window.alert(`ResearchGPT save failed: ${message}`);
    }
  }

  function injectSaveButton(container) {
    if (container.querySelector(BUTTON_SELECTOR)) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "researchai-save-btn";
    button.dataset.researchaiSave = "1";
    setButtonState(button, "idle");

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void savePaper(container, button);
    });

    const linksRow = container.querySelector(".gs_fl");
    if (linksRow) {
      linksRow.appendChild(document.createTextNode(" | "));
      linksRow.appendChild(button);
      return;
    }

    container.appendChild(button);
  }

  function scanResults() {
    document.querySelectorAll(RESULT_SELECTOR).forEach(injectSaveButton);
  }

  scanResults();

  const observer = new MutationObserver(() => {
    scanResults();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
