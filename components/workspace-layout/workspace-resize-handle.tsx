"use client";

import { GripVertical } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  WorkspacePanelConfig,
  WorkspacePanelSide,
} from "./workspace-layout.types";

type WorkspaceResizeHandleProps = {
  side: WorkspacePanelSide;
  currentWidth: number;
  otherPanelWidth: number;
  minimumMainWidth: number;
  panelConfig: WorkspacePanelConfig;
  rootRef: React.RefObject<HTMLDivElement | null>;
  onResizeEnd: (
    side: WorkspacePanelSide,
    width: number,
    otherPanelWidth: number,
  ) => void;
};

export function WorkspaceResizeHandle({
  side,
  currentWidth,
  otherPanelWidth,
  minimumMainWidth,
  panelConfig,
  rootRef,
  onResizeEnd,
}: WorkspaceResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const updateCssWidth = useCallback(
    (width: number) => {
      rootRef.current?.style.setProperty(
        side === "left"
          ? "--workspace-left-width"
          : "--workspace-right-width",
        `${width}px`,
      );
    },
    [rootRef, side],
  );

  const constrain = useCallback(
    (width: number) => {
      const containerWidth =
        rootRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const availableMaximum = Math.max(
        panelConfig.minWidth,
        Math.min(
          panelConfig.maxWidth,
          containerWidth - otherPanelWidth - minimumMainWidth,
        ),
      );
      return Math.min(
        Math.max(width, panelConfig.minWidth),
        availableMaximum,
      );
    },
    [minimumMainWidth, otherPanelWidth, panelConfig, rootRef],
  );

  const finish = useCallback(
    (width: number) => {
      const nextWidth = constrain(width);
      updateCssWidth(nextWidth);
      onResizeEnd(side, nextWidth, otherPanelWidth);
    },
    [constrain, onResizeEnd, otherPanelWidth, side, updateCssWidth],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = currentWidth;
      let latestWidth = currentWidth;
      let frame = 0;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const move = (pointerEvent: PointerEvent) => {
        const delta = pointerEvent.clientX - startX;
        latestWidth = constrain(
          side === "left" ? startWidth + delta : startWidth - delta,
        );
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => updateCssWidth(latestWidth));
      };

      const cleanup = () => {
        cancelAnimationFrame(frame);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        cleanupRef.current = null;
      };

      const end = () => {
        cleanup();
        finish(latestWidth);
      };

      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [constrain, currentWidth, finish, side, updateCssWidth],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const direction =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      const signedStep = side === "left" ? direction * step : -direction * step;
      const requested =
        event.key === "Home"
          ? panelConfig.minWidth
          : event.key === "End"
            ? panelConfig.maxWidth
            : currentWidth + signedStep;
      finish(requested);
    },
    [currentWidth, finish, panelConfig, side],
  );

  return (
    <div
      role="separator"
      aria-label={side === "left" ? "调整左侧导航宽度" : "调整右侧工作台宽度"}
      aria-orientation="vertical"
      aria-valuemin={panelConfig.minWidth}
      aria-valuemax={panelConfig.maxWidth}
      aria-valuenow={Math.round(currentWidth)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => finish(panelConfig.defaultWidth)}
      className="group relative z-30 hidden h-full w-2 shrink-0 cursor-col-resize touch-none items-center justify-center lg:flex"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#dbe4e7] group-hover:bg-[#8eabb8] group-focus-visible:bg-[#245d82]" />
      <span className="relative flex h-10 w-4 items-center justify-center rounded-full border border-[#d4dfe2] bg-white text-[#7c8b91] shadow-sm">
        <GripVertical className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}
