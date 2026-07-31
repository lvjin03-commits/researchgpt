"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkspaceLayoutConfig,
  WorkspaceLayoutState,
  WorkspacePanelSide,
} from "./workspace-layout.types";

const STORAGE_KEY = "researchgpt:chat-workspace-layout:v1";

export const WORKSPACE_LAYOUT_CONFIG: WorkspaceLayoutConfig = {
  left: { defaultWidth: 292, minWidth: 240, maxWidth: 380 },
  right: { defaultWidth: 440, minWidth: 340, maxWidth: 640 },
  minimumMainWidth: 420,
};

const DEFAULT_STATE: WorkspaceLayoutState = {
  leftWidth: WORKSPACE_LAYOUT_CONFIG.left.defaultWidth,
  rightWidth: WORKSPACE_LAYOUT_CONFIG.right.defaultWidth,
  leftCollapsed: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readStoredState(): WorkspaceLayoutState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const value = JSON.parse(raw) as Partial<WorkspaceLayoutState>;
    return {
      leftWidth: finiteNumber(value.leftWidth)
        ? clamp(
            value.leftWidth,
            WORKSPACE_LAYOUT_CONFIG.left.minWidth,
            WORKSPACE_LAYOUT_CONFIG.left.maxWidth,
          )
        : DEFAULT_STATE.leftWidth,
      rightWidth: finiteNumber(value.rightWidth)
        ? clamp(
            value.rightWidth,
            WORKSPACE_LAYOUT_CONFIG.right.minWidth,
            WORKSPACE_LAYOUT_CONFIG.right.maxWidth,
          )
        : DEFAULT_STATE.rightWidth,
      leftCollapsed:
        typeof value.leftCollapsed === "boolean"
          ? value.leftCollapsed
          : DEFAULT_STATE.leftCollapsed,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function useWorkspaceLayout() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<WorkspaceLayoutState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLayout(readStoredState());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [hydrated, layout]);

  const maximumWidthFor = useCallback(
    (side: WorkspacePanelSide, otherPanelWidth: number) => {
      const containerWidth =
        rootRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const panelConfig = WORKSPACE_LAYOUT_CONFIG[side];
      return Math.max(
        panelConfig.minWidth,
        Math.min(
          panelConfig.maxWidth,
          containerWidth -
            otherPanelWidth -
            WORKSPACE_LAYOUT_CONFIG.minimumMainWidth,
        ),
      );
    },
    [],
  );

  const commitWidth = useCallback(
    (
      side: WorkspacePanelSide,
      requestedWidth: number,
      otherPanelWidth: number,
    ) => {
      const panelConfig = WORKSPACE_LAYOUT_CONFIG[side];
      const width = clamp(
        requestedWidth,
        panelConfig.minWidth,
        maximumWidthFor(side, otherPanelWidth),
      );
      setLayout((current) => ({
        ...current,
        [side === "left" ? "leftWidth" : "rightWidth"]: width,
      }));
    },
    [maximumWidthFor],
  );

  const toggleLeft = useCallback(() => {
    setLayout((current) => ({
      ...current,
      leftCollapsed: !current.leftCollapsed,
    }));
  }, []);

  return {
    rootRef,
    layout,
    commitWidth,
    toggleLeft,
  };
}
