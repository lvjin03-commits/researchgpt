(function () {
  const BUTTON_SELECTOR = "[data-researchai-save]";
  const RESULT_SELECTOR = ".gs_r.gs_or.gs_scl";

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

  function parsePdfUrl(container) {
    const sideLink = container.querySelector(".gs_or_ggsm a");
    return sideLink instanceof HTMLAnchorElement ? sideLink.href : "";
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
    button.disabled = state === "saving" || state === "saved";

    if (state === "idle") {
      button.textContent = "Save to My Library";
      button.title = "";
      return;
    }

    if (state === "saving") {
      button.textContent = "Saving…";
      button.title = "Saving to ResearchAI";
      return;
    }

    if (state === "saved") {
      button.textContent = "Saved";
      button.title = message || "Saved to ResearchAI";
      return;
    }

    button.textContent = "Retry save";
    button.title = message || "Save failed";
  }

  async function savePaper(container, button) {
    const paper = parsePaperFromContainer(container);
    if (!paper) {
      setButtonState(button, "error", "Could not read this result.");
      return;
    }

    setButtonState(button, "saving");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_PAPER",
        paper,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Save failed.");
      }

      setButtonState(
        button,
        "saved",
        response.saved?.title ? `Saved "${response.saved.title}"` : "Saved to ResearchAI",
      );
    } catch (error) {
      setButtonState(
        button,
        "error",
        error instanceof Error ? error.message : "Save failed.",
      );
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
      linksRow.appendChild(document.createTextNode(" · "));
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
