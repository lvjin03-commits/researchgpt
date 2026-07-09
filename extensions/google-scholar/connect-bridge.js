(async () => {
  try {
    const response = await fetch("/api/extension/session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload?.accessToken) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "AUTH_TOKEN",
      accessToken: payload.accessToken,
    });
  } catch {
    // User may open this page without the extension installed.
  }
})();
