from __future__ import annotations

from pathlib import Path
import threading

from app.domain.contracts import FailurePayload
from app.storage.execution_store import ExecutionStore
from app.storm_adapter.runner import ExplorationRunner


class ExplorationWorker:
    def __init__(self, store: ExecutionStore, runner: ExplorationRunner, output_root: Path) -> None:
        self.store = store
        self.runner = runner
        self.output_root = output_root

    def run_once(self) -> bool:
        record = self.store.claim_next()
        if not record:
            return False
        heartbeat_stop = threading.Event()
        heartbeat_failure: list[Exception] = []

        def maintain_lease() -> None:
            while not heartbeat_stop.wait(20):
                try:
                    if not self.store.heartbeat(record):
                        raise RuntimeError("STORM execution lease was lost")
                except Exception as error:  # surfaced after the provider call returns
                    heartbeat_failure.append(error)
                    heartbeat_stop.set()

        heartbeat_thread = threading.Thread(target=maintain_lease, daemon=True)
        heartbeat_thread.start()
        try:
            if record.cancel_requested:
                record.status = "cancelled"
                record.phase = "cancelled"
                self.store.save(record)
                return True
            result = self.runner.run(
                record.request,
                self.output_root / record.remote_execution_id,
            )
            latest = self.store.get(record.remote_execution_id)
            if latest and latest.cancel_requested:
                latest.status = "cancelled"
                latest.phase = "cancelled"
                self.store.save(latest)
                return True
            if heartbeat_failure:
                raise heartbeat_failure[0]
            if not self.store.complete(record, result):
                raise RuntimeError("STORM completion was rejected by fencing token")
        except Exception as error:  # Worker boundary: persist failure evidence, never hide it.
            record.status = "failed"
            record.phase = "failed"
            record.failure = FailurePayload(
                code="storm_execution_failed",
                category="infrastructure",
                retryability="none",
                technicalMessage=f"{type(error).__name__}: {error}",
                userMessageCode="research_exploration_failed",
            ).model_dump(mode="json", by_alias=True)
            self.store.save(record)
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=2)
        return True
