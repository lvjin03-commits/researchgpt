(function () {
  const DEFAULT_BASE_URL = "http://localhost:3000";
  const panelId = "researchai-scholar-panel";
  let papers = [];
  let selected = new Set();

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
      return { citedByCount: null, citedByUrl: "" };
    }

    const count = Number(text(cited).replace(/\D/g, ""));
    return {
      citedByCount: Number.isFinite(count) ? count : null,
      citedByUrl: cited.href || "",
    };
  }

  function parsePdfUrl(container) {
    const sideLink = container.querySelector(".gs_or_ggsm a");
    return sideLink instanceof HTMLAnchorElement ? sideLink.href : "";
  }

  function readScholarResults() {
    return Array.from(document.querySelectorAll(".gs_r.gs_or.gs_scl"))
      .map((container, index) => {
        const titleAnchor = container.querySelector(".gs_rt a");
        const titleNode = titleAnchor || container.querySelector(".gs_rt");
        const title = text(titleNode).replace(/^\[[^\]]+\]\s*/, "");
        const url = titleAnchor instanceof HTMLAnchorElement ? titleAnchor.href : "";
        const meta = text(container.querySelector(".gs_a"));
        const snippet = text(container.querySelector(".gs_rs"));
        const cited = parseCitedBy(container);

        if (!title || !url) {
          return null;
        }

        return {
          id: `${index}-${url}`,
          title,
          url,
          authors: parseAuthors(meta),
          venue: meta,
          year: parseYear(meta),
          snippet,
          pdfUrl: parsePdfUrl(container),
          citedByCount: cited.citedByCount,
          citedByUrl: cited.citedByUrl,
        };
      })
      .filter(Boolean);
  }

  function getCheckedPapers() {
    return papers.filter((paper) => selected.has(paper.id));
  }

  function setStatus(message) {
    const status = document.querySelector(`#${panelId} .researchai-status`);
    if (status) {
      status.textContent = message;
    }
  }

  function renderItems() {
    const body = document.querySelector(`#${panelId} .researchai-body`);
    const count = document.querySelector(`#${panelId} .researchai-count`);
    if (!body || !count) {
      return;
    }

    count.textContent = `${selected.size}/${papers.length} selected`;

    if (papers.length === 0) {
      body.innerHTML = '<div class="researchai-empty">No Google Scholar results found on this page.</div>';
      return;
    }

    body.innerHTML = papers
      .map(
        (paper) => `
          <label class="researchai-item">
            <input type="checkbox" data-researchai-id="${paper.id}" ${
              selected.has(paper.id) ? "checked" : ""
            }>
            <span>
              <a class="researchai-item-title" href="${paper.url}" target="_blank" rel="noreferrer">${paper.title}</a>
              <div class="researchai-item-meta">${paper.venue || "Unknown venue"}</div>
              <div class="researchai-item-cites">${
                paper.citedByCount === null ? "No citation count" : `Cited by ${paper.citedByCount}`
              }</div>
            </span>
          </label>
        `,
      )
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.getAttribute("data-researchai-id");
        if (!id) return;
        if (input.checked) {
          selected.add(id);
        } else {
          selected.delete(id);
        }
        renderItems();
      });
    });
  }

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          researchAiBaseUrl: DEFAULT_BASE_URL,
          researchAiFolderIds: [],
        },
        resolve,
      );
    });
  }

  async function saveSelected() {
    const chosen = getCheckedPapers();
    if (chosen.length === 0) {
      setStatus("Select at least one paper.");
      return;
    }

    const settings = await getSettings();
    const baseUrl = String(settings.researchAiBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const folderIds = Array.isArray(settings.researchAiFolderIds)
      ? settings.researchAiFolderIds
      : [];

    setStatus(`Saving ${chosen.length} paper(s)...`);

    try {
      const response = await fetch(`${baseUrl}/api/literature/imports/google-scholar`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papers: chosen, folderIds }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `ResearchAI returned ${response.status}`);
      }

      setStatus(`Saved ${payload.count || chosen.length} paper(s) to ResearchAI.`);
    } catch (error) {
      setStatus(
        `Save failed. Open ResearchAI and sign in, then try again. ${error.message || ""}`,
      );
    }
  }

  function renderPanel() {
    const existing = document.getElementById(panelId);
    if (existing) {
      existing.remove();
    }

    papers = readScholarResults();
    selected = new Set(papers.map((paper) => paper.id));

    const panel = document.createElement("aside");
    panel.id = panelId;
    panel.className = "researchai-panel";
    panel.innerHTML = `
      <div class="researchai-header">
        <div>
          <div class="researchai-title">ResearchAI Scholar Saver</div>
          <div class="researchai-count"></div>
        </div>
        <button class="researchai-button" data-action="refresh">Refresh</button>
      </div>
      <div class="researchai-body"></div>
      <div class="researchai-actions">
        <button class="researchai-button" data-action="select-all">Select all</button>
        <button class="researchai-button" data-action="clear">Clear</button>
        <button class="researchai-button researchai-button-primary" data-action="save">Save selected</button>
        <button class="researchai-button" data-action="hide">Hide</button>
        <div class="researchai-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector("[data-action='refresh']").addEventListener("click", renderPanel);
    panel.querySelector("[data-action='select-all']").addEventListener("click", () => {
      selected = new Set(papers.map((paper) => paper.id));
      renderItems();
    });
    panel.querySelector("[data-action='clear']").addEventListener("click", () => {
      selected = new Set();
      renderItems();
    });
    panel.querySelector("[data-action='save']").addEventListener("click", () => {
      void saveSelected();
    });
    panel.querySelector("[data-action='hide']").addEventListener("click", () => {
      panel.remove();
    });

    renderItems();
  }

  renderPanel();
})();
