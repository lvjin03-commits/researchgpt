"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DocumentJobSnapshotSchema,
  type DocumentJobSnapshot,
} from "@/lib/document-v2/runtime/contracts";
import { DocumentV2JobProgress } from "./document-v2-job-progress";

type Props = {
  jobId: string;
  initialSnapshot: DocumentJobSnapshot;
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function DocumentV2JobMonitor({
  jobId,
  initialSnapshot,
}: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
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
    if (!TERMINAL_STATUSES.has(snapshot.job.status)) schedule(1_500);
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh, snapshot.job.status]);

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

  return (
    <div>
      <DocumentV2JobProgress
        snapshot={snapshot}
        busy={busy}
        onCancel={() => void control("cancel")}
        onResume={() => void control("resume")}
      />
      {connectionMessage ? (
        <p className="mt-2 text-sm text-amber-700" role="status">
          {connectionMessage}
        </p>
      ) : null}
    </div>
  );
}
