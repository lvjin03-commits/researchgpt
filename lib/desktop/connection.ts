export const DESKTOP_STATUS_URL = "http://127.0.0.1:48732/status";
export const DESKTOP_CONNECT_URL = "researchgpt://connect";

export type DesktopConnectionState =
  | "checking"
  | "connected"
  | "disconnected"
  | "connecting"
  | "failed";

export type DesktopStatus = {
  online: boolean;
  app?: string;
  version?: string;
  userId?: string;
  deviceName?: string;
  capabilities?: string[];
};

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
    app: typeof data.app === "string" ? data.app : "ResearchGPT Desktop",
    version: typeof data.version === "string" ? data.version : undefined,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    deviceName:
      typeof data.deviceName === "string" ? data.deviceName : undefined,
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter(
          (capability): capability is string =>
            typeof capability === "string" && capability.trim().length > 0,
        )
      : [],
  };
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
