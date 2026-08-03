from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from app.api.explorations import router
from app.service import ExplorationService
from app.storage.execution_store import SqliteExecutionStore
from app.storm_adapter.runner_factory import (
    admission_status,
    dependency_available,
    provider_configuration_available,
    runtime_approved,
)


def create_app(database_path: Path | None = None) -> FastAPI:
    default_data_root = Path(__file__).resolve().parents[1] / ".storm-exploration-data"
    data_root = Path(os.getenv("STORM_EXPLORATION_DATA_DIR", str(default_data_root)))
    store = SqliteExecutionStore(database_path or data_root / "explorations.sqlite3")
    app = FastAPI(title="ResearchGPT STORM Exploration", version="0.1.0")
    app.state.exploration_service = ExplorationService(store)
    app.state.execution_store = store
    app.include_router(router)

    @app.get("/health")
    def health() -> dict[str, object]:
        dependency_ready = dependency_available()
        provider_ready = provider_configuration_available()
        return {
            "status": "ok",
            "runtimeAdmissionStatus": admission_status(),
            "runtimeApproved": runtime_approved(),
            "stormDependencyAvailable": dependency_ready,
            "providerConfigured": provider_ready,
            "productionReady": runtime_approved() and dependency_ready and provider_ready,
        }

    return app


app = create_app()
