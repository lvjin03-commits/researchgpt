"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useState } from "react";

const LEFT_LIMITS = { min: 240, max: 420, initial: 300 } as const;
const RIGHT_LIMITS = { min: 300, max: 700, initial: 400 } as const;
const CENTER_MIN_WIDTH = 560;
const KEYBOARD_STEP = 16;

type Side = "left" | "right";

type DragState = {
  side: Side;
  pointerId: number;
  startX: number;
  startWidth: number;
} | null;

type Props = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function fontScale(width: number, min: number, max: number) {
  const progress = (width - min) / (max - min);
  return 0.9 + progress * 0.2;
}

function panelStyle(width: number, min: number, max: number): CSSProperties {
  return {
    "--grant-panel-font-scale": fontScale(width, min, max).toFixed(3),
  } as CSSProperties;
}

export function GrantResizableWorkspace({ left, center, right }: Props) {
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_LIMITS.initial);
  const [rightWidth, setRightWidth] = useState<number>(RIGHT_LIMITS.initial);
  const [drag, setDrag] = useState<DragState>(null);

  function availableMaximum(side: Side) {
    const configuredMaximum = side === "left" ? LEFT_LIMITS.max : RIGHT_LIMITS.max;
    if (typeof window === "undefined") return configuredMaximum;
    const otherWidth = side === "left" ? rightWidth : leftWidth;
    const reserved = CENTER_MIN_WIDTH + otherWidth + 16;
    return Math.max(side === "left" ? LEFT_LIMITS.min : RIGHT_LIMITS.min, Math.min(configuredMaximum, window.innerWidth - reserved));
  }

  function updateWidth(side: Side, nextWidth: number) {
    const limits = side === "left" ? LEFT_LIMITS : RIGHT_LIMITS;
    const width = clamp(nextWidth, limits.min, availableMaximum(side));
    if (side === "left") setLeftWidth(width); else setRightWidth(width);
  }

  function beginDrag(side: Side, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: side === "left" ? leftWidth : rightWidth,
    });
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    updateWidth(drag.side, drag.startWidth + (drag.side === "left" ? delta : -delta));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  function resizeWithKeyboard(side: Side, event: KeyboardEvent<HTMLDivElement>) {
    const current = side === "left" ? leftWidth : rightWidth;
    const limits = side === "left" ? LEFT_LIMITS : RIGHT_LIMITS;
    const increaseKey = side === "left" ? "ArrowRight" : "ArrowLeft";
    const decreaseKey = side === "left" ? "ArrowLeft" : "ArrowRight";
    let next: number | null = null;
    if (event.key === increaseKey) next = current + KEYBOARD_STEP;
    if (event.key === decreaseKey) next = current - KEYBOARD_STEP;
    if (event.key === "Home") next = limits.min;
    if (event.key === "End") next = availableMaximum(side);
    if (next === null) return;
    event.preventDefault();
    updateWidth(side, next);
  }

  const gridStyle = {
    "--grant-left-panel-width": `${leftWidth}px`,
    "--grant-right-panel-width": `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`grant-workspace-grid min-h-[calc(100vh-4rem)] xl:min-h-0 xl:flex-1 xl:overflow-hidden ${drag ? "select-none" : ""}`}
      style={gridStyle}
    >
      <div className="grant-resizable-panel min-w-0 xl:h-full xl:min-h-0 xl:overflow-hidden" style={panelStyle(leftWidth, LEFT_LIMITS.min, LEFT_LIMITS.max)}>
        {left}
      </div>
      <ResizeHandle
        side="left"
        value={leftWidth}
        min={LEFT_LIMITS.min}
        max={LEFT_LIMITS.max}
        onPointerDown={(event) => beginDrag("left", event)}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => resizeWithKeyboard("left", event)}
      />
      <div className="min-w-0 xl:h-full xl:min-h-0 xl:overflow-y-auto">{center}</div>
      <ResizeHandle
        side="right"
        value={rightWidth}
        min={RIGHT_LIMITS.min}
        max={RIGHT_LIMITS.max}
        onPointerDown={(event) => beginDrag("right", event)}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => resizeWithKeyboard("right", event)}
      />
      <div className="grant-resizable-panel min-w-0 xl:h-full xl:min-h-0 xl:overflow-hidden" style={panelStyle(rightWidth, RIGHT_LIMITS.min, RIGHT_LIMITS.max)}>
        {right}
      </div>
    </div>
  );
}

type ResizeHandleProps = {
  side: Side;
  value: number;
  min: number;
  max: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function ResizeHandle({ side, value, min, max, ...events }: ResizeHandleProps) {
  const label = side === "left" ? "调整左侧文档结构栏宽度" : "调整右侧问题栏宽度";
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className="grant-workspace-resize-handle hidden xl:block"
      {...events}
    >
      <span aria-hidden />
    </div>
  );
}
