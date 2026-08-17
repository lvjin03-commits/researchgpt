"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

const LEFT_LIMITS = { min: 240, max: 420, initial: 300 } as const;
const ASSISTANT_LIMITS = { min: 320, max: 560, initial: 360 } as const;
const RIGHT_LIMITS = { min: 300, max: 700, initial: 400 } as const;
const CENTER_MIN_WIDTH = 560;
const ASSISTANT_COLLAPSED_WIDTH = 48;
const KEYBOARD_STEP = 16;

type Side = "left" | "assistant" | "right";

type DragState = {
  side: Side;
  pointerId: number;
  startX: number;
  startWidth: number;
} | null;

type Props = {
  left: ReactNode;
  center: ReactNode;
  assistant?: ReactNode;
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

export function GrantResizableWorkspace({ left, center, assistant, right }: Props) {
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_LIMITS.initial);
  const [assistantWidth, setAssistantWidth] = useState<number>(ASSISTANT_LIMITS.initial);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [rightWidth, setRightWidth] = useState<number>(RIGHT_LIMITS.initial);
  const [drag, setDrag] = useState<DragState>(null);

  useEffect(() => {
    if (window.innerWidth < 1440) {
      setAssistantCollapsed(true);
      setLeftWidth(260);
      setRightWidth(340);
    }
  }, []);

  function sideLimits(side: Side) {
    if (side === "left") return LEFT_LIMITS;
    if (side === "assistant") return ASSISTANT_LIMITS;
    return RIGHT_LIMITS;
  }

  function sideWidth(side: Side) {
    if (side === "left") return leftWidth;
    if (side === "assistant") return assistantWidth;
    return rightWidth;
  }

  function availableMaximum(side: Side) {
    const configuredMaximum = sideLimits(side).max;
    if (typeof window === "undefined") return configuredMaximum;
    const visibleAssistantWidth = assistant && !assistantCollapsed ? assistantWidth : assistant ? ASSISTANT_COLLAPSED_WIDTH : 0;
    const occupied = leftWidth + visibleAssistantWidth + rightWidth - sideWidth(side);
    const handleWidth = assistant ? 24 : 16;
    const reserved = CENTER_MIN_WIDTH + occupied + handleWidth;
    return Math.max(sideLimits(side).min, Math.min(configuredMaximum, window.innerWidth - reserved));
  }

  function updateWidth(side: Side, nextWidth: number) {
    const limits = sideLimits(side);
    const width = clamp(nextWidth, limits.min, availableMaximum(side));
    if (side === "left") setLeftWidth(width);
    else if (side === "assistant") setAssistantWidth(width);
    else setRightWidth(width);
  }

  function beginDrag(side: Side, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sideWidth(side),
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
    const current = sideWidth(side);
    const limits = sideLimits(side);
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
    "--grant-assistant-handle-width": assistant ? "8px" : "0px",
    "--grant-assistant-panel-width": `${assistant && !assistantCollapsed ? assistantWidth : assistant ? ASSISTANT_COLLAPSED_WIDTH : 0}px`,
    "--grant-right-panel-width": `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`grant-workspace-grid min-h-[calc(100vh-4rem)] xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-hidden ${drag ? "select-none" : ""}`}
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
      {assistant ? <>
        <ResizeHandle
          side="assistant"
          value={assistantWidth}
          min={ASSISTANT_LIMITS.min}
          max={ASSISTANT_LIMITS.max}
          disabled={assistantCollapsed}
          onPointerDown={(event) => beginDrag("assistant", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => resizeWithKeyboard("assistant", event)}
        />
        <aside
          aria-label="Grant AI 助手"
          className="grant-resizable-panel relative min-w-0 border-t border-slate-200 bg-white xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden xl:border-l xl:border-t-0"
          style={panelStyle(assistantWidth, ASSISTANT_LIMITS.min, ASSISTANT_LIMITS.max)}
        >
          <header className={`flex h-14 shrink-0 items-center border-b border-slate-200 ${assistantCollapsed ? "justify-center px-1" : "justify-between px-4"}`}>
            {!assistantCollapsed && <div><p className="text-sm font-semibold text-slate-900">Grant AI 助手</p><p className="text-xs text-slate-500">对话与正文修改</p></div>}
            <button
              type="button"
              aria-label={assistantCollapsed ? "展开 Grant AI 助手" : "折叠 Grant AI 助手"}
              title={assistantCollapsed ? "展开 AI 助手" : "折叠 AI 助手"}
              onClick={() => setAssistantCollapsed((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm font-semibold text-[#155eef] hover:bg-blue-50"
            >
              {assistantCollapsed ? "AI" : "›"}
            </button>
          </header>
          <div className={`min-h-0 flex-1 overflow-hidden ${assistantCollapsed ? "invisible absolute inset-0 pointer-events-none" : "p-3"}`}>
            {assistant}
          </div>
        </aside>
      </> : <><div aria-hidden /><div aria-hidden /></>}
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
      <div className="grant-resizable-panel min-w-0 xl:flex xl:h-full xl:min-h-0 xl:overflow-hidden" style={panelStyle(rightWidth, RIGHT_LIMITS.min, RIGHT_LIMITS.max)}>
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
  disabled?: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function ResizeHandle({ side, value, min, max, disabled = false, ...events }: ResizeHandleProps) {
  const label = side === "left" ? "调整左侧文档结构栏宽度" : side === "assistant" ? "调整 Grant AI 助手栏宽度" : "调整右侧问题栏宽度";
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={`grant-workspace-resize-handle hidden xl:block ${disabled ? "pointer-events-none opacity-0" : ""}`}
      {...(disabled ? {} : events)}
    >
      <span aria-hidden />
    </div>
  );
}
