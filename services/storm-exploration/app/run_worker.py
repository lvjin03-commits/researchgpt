from __future__ import annotations

import os
from pathlib import Path

from app.storage.execution_store import SqliteExecutionStore
from app.storm_adapter.runner import StormWikiExplorationRunner
from app.storm_adapter.runner_factory import create_real_runner
from app.worker import ExplorationWorker


def main() -> int:
    default_data_root = Path(__file__).resolve().parents[1] / ".storm-exploration-data"
    data_root = Path(os.getenv("STORM_EXPLORATION_DATA_DIR", str(default_data_root)))
    store = SqliteExecutionStore(data_root / "explorations.sqlite3")
    worker = ExplorationWorker(
        store,
        StormWikiExplorationRunner(create_real_runner()),
        data_root / "outputs",
    )
    return 0 if worker.run_once() else 2


if __name__ == "__main__":
    raise SystemExit(main())
