from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.domain.contracts import ExplorationRequest, StartResponse, StatusResponse
from app.storage.execution_store import ExecutionRecord, ExecutionStore, request_hash


class ExplorationNotFound(KeyError):
    pass


class ExplorationConflict(ValueError):
    pass


class ExplorationService:
    def __init__(self, store: ExecutionStore) -> None:
        self.store = store

    def start(self, request: ExplorationRequest) -> StartResponse:
        fingerprint = request_hash(request)
        record = ExecutionRecord(
            remote_execution_id=str(uuid4()),
            request=request,
            request_fingerprint=fingerprint,
            status="queued",
            phase="queued",
        )
        stored, created = self.store.create_or_get(record)
        if not created and stored.request_fingerprint != fingerprint:
            raise ExplorationConflict(
                "explorationId already exists with a different immutable request"
            )
        return StartResponse(
            remoteExecutionId=stored.remote_execution_id,
            status="running" if stored.status == "running" else "queued",
            nextCheckAt=datetime.now(UTC) + timedelta(seconds=2),
        )

    def status(self, remote_execution_id: str) -> StatusResponse:
        record = self._required(remote_execution_id)
        return StatusResponse(
            remoteExecutionId=record.remote_execution_id,
            status=record.status,
            phase=record.phase,
            resultLocation=record.result_location,
            failure=record.failure,
        )

    def cancel(self, remote_execution_id: str) -> StatusResponse:
        record = self._required(remote_execution_id)
        if record.status in {"complete", "partial", "failed", "expired", "cancelled"}:
            return self.status(remote_execution_id)
        record.cancel_requested = True
        if record.status == "queued":
            record.status = "cancelled"
            record.phase = "cancelled"
        self.store.save(record)
        return self.status(remote_execution_id)

    def result(self, remote_execution_id: str):
        self._required(remote_execution_id)
        return self.store.load_result(remote_execution_id)

    def _required(self, remote_execution_id: str) -> ExecutionRecord:
        record = self.store.get(remote_execution_id)
        if not record:
            raise ExplorationNotFound(remote_execution_id)
        return record
