"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DocumentJobSnapshotSchema,
  type DocumentJobSnapshot,
} from "@/lib/document-v2/runtime/contracts";
import { DocumentV2JobProgress } from "./document-v2-job-progress";

type Props = {
  jobId: string;
  initialSnapshot?: DocumentJobSnapshot;
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
  "budget_exhausted",
  "awaiting_user_input",
]);

export function DocumentV2JobMonitor({
  jobId,
  initialSnapshot,
}: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const readResponse = useCallback(async (response: Response) => {
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "无法读取任务状态。";
      throw new Error(message);
    }
    return DocumentJobSnapshotSchema.parse(payload);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/document-v2/jobs/${jobId}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const next = await readResponse(response);
    setSnapshot(next);
    setConnectionMessage(undefined);
    return next;
  }, [jobId, readResponse]);

  useEffect(() => {
    let disposed = false;
    let failureCount = 0;
    const schedule = (delay: number) => {
      timerRef.current = setTimeout(async () => {
        if (disposed || document.visibilityState === "hidden") {
          schedule(2_000);
          return;
        }
        try {
          const next = await refresh();
          failureCount = 0;
          if (!TERMINAL_STATUSES.has(next.job.status)) schedule(1_500);
        } catch {
          failureCount += 1;
          setConnectionMessage("正在重新连接任务状态……");
          schedule(Math.min(10_000, 1_500 * 2 ** failureCount));
        }
      }, delay);
    };
    if (!snapshot || !TERMINAL_STATUSES.has(snapshot.job.status)) schedule(0);
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh, snapshot?.job.status]);

  const control = async (action: "cancel" | "resume") => {
    setBusy(true);
    setConnectionMessage(undefined);
    try {
      const response = await fetch(`/api/document-v2/jobs/${jobId}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      setSnapshot(await readResponse(response));
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : "任务操作失败。",
      );
    } finally {
      setBusy(false);
    }
  };

  const clarify = async () => {
    if (!snapshot?.job.clarification || !clarificationAnswer.trim()) return;
    setBusy(true);
    setConnectionMessage(undefined);
    try {
      const response = await fetch(`/api/document-v2/jobs/${jobId}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "clarify",
          questionId: snapshot.job.clarification.questionId,
          answer: clarificationAnswer.trim(),
        }),
      });
      setSnapshot(await readResponse(response));
      setClarificationAnswer("");
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : "提交补充信息失败。",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) {
    return (
      <div className="my-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
        正在读取文档任务状态……
      </div>
    );
  }

  return (
    <div>
      <DocumentV2JobProgress
        snapshot={snapshot}
        busy={busy}
        onCancel={() => void control("cancel")}
        onResume={() => void control("resume")}
      />
      {snapshot.job.status === "awaiting_user_input" &&
      snapshot.job.clarification ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-950">
            {snapshot.job.clarification.question}
          </p>
          <textarea
            value={clarificationAnswer}
            onChange={(event) => setClarificationAnswer(event.target.value)}
            disabled={busy}
            rows={3}
            className="mt-3 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
            placeholder="请补充主题或范围"
          />
          <button
            type="button"
            disabled={busy || !clarificationAnswer.trim()}
            onClick={() => void clarify()}
            className="mt-2 rounded-lg bg-amber-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            提交并继续生成
          </button>
        </div>
      ) : null}
      {connectionMessage ? (
        <p className="mt-2 text-sm text-amber-700" role="status">
          {connectionMessage}
        </p>
      ) : null}
    </div>
  );
}
