from __future__ import annotations

import os
import socket
from pathlib import Path

from app.storage.execution_store import SqliteExecutionStore, SupabaseExecutionStore
from app.storm_adapter.runner_factory import create_real_runner
from app.worker import ExplorationWorker


def main() -> int:
    default_data_root = Path(__file__).resolve().parents[1] / ".storm-exploration-data"
    data_root = Path(os.getenv("STORM_EXPLORATION_DATA_DIR", str(default_data_root)))
    execution_id = os.getenv("STORM_EXECUTION_ID", "").strip()
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if execution_id:
        if not supabase_url or not service_role_key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Cloud Run jobs"
            )
        store = SupabaseExecutionStore(
            supabase_url=supabase_url,
            service_role_key=service_role_key,
            target_execution_id=execution_id,
            lease_owner=f"{socket.gethostname()}:{os.getpid()}",
        )
    else:
        store = SqliteExecutionStore(data_root / "explorations.sqlite3")
    worker = ExplorationWorker(
        store,
        create_real_runner(),
        data_root / "outputs",
    )
    return 0 if worker.run_once() else 2


if __name__ == "__main__":
    raise SystemExit(main())
