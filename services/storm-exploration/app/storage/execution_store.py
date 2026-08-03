from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.domain.contracts import ExplorationRequest, ExplorationResult, ExplorationStatus


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def request_hash(request: ExplorationRequest) -> str:
    payload = request.model_dump(mode="json", by_alias=True)
    payload.pop("explorationId", None)
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ExecutionRecord:
    def __init__(
        self,
        *,
        remote_execution_id: str,
        request: ExplorationRequest,
        request_fingerprint: str,
        status: ExplorationStatus,
        phase: str,
        cancel_requested: bool = False,
        result_location: str | None = None,
        failure: dict | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> None:
        self.remote_execution_id = remote_execution_id
        self.request = request
        self.request_fingerprint = request_fingerprint
        self.status = status
        self.phase = phase
        self.cancel_requested = cancel_requested
        self.result_location = result_location
        self.failure = failure
        self.created_at = created_at or utc_now()
        self.updated_at = updated_at or self.created_at


class ExecutionStore(Protocol):
    def create_or_get(self, record: ExecutionRecord) -> tuple[ExecutionRecord, bool]: ...
    def get(self, remote_execution_id: str) -> ExecutionRecord | None: ...
    def claim_next(self) -> ExecutionRecord | None: ...
    def save(self, record: ExecutionRecord) -> None: ...
    def save_result(self, remote_execution_id: str, result: ExplorationResult) -> str: ...
    def load_result(self, remote_execution_id: str) -> ExplorationResult | None: ...


class SqliteExecutionStore:
    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.database_path = database_path
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS explorations (
                    remote_execution_id TEXT PRIMARY KEY,
                    exploration_id TEXT NOT NULL UNIQUE,
                    request_fingerprint TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    result_location TEXT,
                    result_json TEXT,
                    failure_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> ExecutionRecord:
        return ExecutionRecord(
            remote_execution_id=row["remote_execution_id"],
            request=ExplorationRequest.model_validate_json(row["request_json"]),
            request_fingerprint=row["request_fingerprint"],
            status=row["status"],
            phase=row["phase"],
            cancel_requested=bool(row["cancel_requested"]),
            result_location=row["result_location"],
            failure=json.loads(row["failure_json"]) if row["failure_json"] else None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_or_get(self, record: ExecutionRecord) -> tuple[ExecutionRecord, bool]:
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM explorations WHERE exploration_id = ?",
                (record.request.exploration_id,),
            ).fetchone()
            if existing:
                return self._row_to_record(existing), False
            connection.execute(
                """
                INSERT INTO explorations (
                    remote_execution_id, exploration_id, request_fingerprint,
                    request_json, status, phase, cancel_requested,
                    result_location, failure_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.remote_execution_id,
                    record.request.exploration_id,
                    record.request_fingerprint,
                    record.request.model_dump_json(by_alias=True),
                    record.status,
                    record.phase,
                    int(record.cancel_requested),
                    record.result_location,
                    json.dumps(record.failure) if record.failure else None,
                    record.created_at,
                    record.updated_at,
                ),
            )
            return record, True

    def get(self, remote_execution_id: str) -> ExecutionRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM explorations WHERE remote_execution_id = ?",
                (remote_execution_id,),
            ).fetchone()
        return self._row_to_record(row) if row else None

    def claim_next(self) -> ExecutionRecord | None:
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM explorations WHERE status = 'queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                connection.commit()
                return None
            now = utc_now()
            connection.execute(
                "UPDATE explorations SET status = 'running', phase = 'research', updated_at = ? WHERE remote_execution_id = ? AND status = 'queued'",
                (now, row["remote_execution_id"]),
            )
            connection.commit()
        claimed = self.get(row["remote_execution_id"])
        return claimed

    def save(self, record: ExecutionRecord) -> None:
        record.updated_at = utc_now()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE explorations SET status = ?, phase = ?, cancel_requested = ?,
                    result_location = ?, failure_json = ?, updated_at = ?
                WHERE remote_execution_id = ?
                """,
                (
                    record.status,
                    record.phase,
                    int(record.cancel_requested),
                    record.result_location,
                    json.dumps(record.failure) if record.failure else None,
                    record.updated_at,
                    record.remote_execution_id,
                ),
            )

    def save_result(self, remote_execution_id: str, result: ExplorationResult) -> str:
        location = f"exploration://{remote_execution_id}/result-v1"
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE explorations SET result_location = ?, result_json = ?, updated_at = ? WHERE remote_execution_id = ?",
                (location, result.model_dump_json(by_alias=True), utc_now(), remote_execution_id),
            )
        return location

    def load_result(self, remote_execution_id: str) -> ExplorationResult | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT result_json FROM explorations WHERE remote_execution_id = ?",
                (remote_execution_id,),
            ).fetchone()
        if not row or not row["result_json"]:
            return None
        return ExplorationResult.model_validate_json(row["result_json"])
