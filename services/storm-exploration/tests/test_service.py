from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.domain.contracts import (
    ExplorationResult,
    OutlineCandidate,
    OutlineSectionCandidate,
    PerspectiveCandidate,
    QuestionCandidate,
)
from app.main import create_app
from app.storm_adapter.runner_factory import (
    StormDependencyUnavailable,
    create_real_runner,
)
from app.worker import ExplorationWorker


def request_payload(exploration_id: str = "exploration-1") -> dict:
    return {
        "schemaVersion": "storm-exploration-request-v1",
        "explorationId": exploration_id,
        "topic": "Physical gel preparation",
        "purpose": "literature_review",
        "language": "en",
        "scope": {"disciplines": [], "excludedTopics": []},
        "sourcePolicy": {
            "useWeb": True,
            "useUserDocuments": False,
            "userResourceIds": [],
        },
        "limits": {
            "maxPerspectives": 3,
            "maxQuestionsPerPerspective": 3,
            "maxSearchQueries": 20,
            "maxSources": 20,
            "maximumWallTimeMs": 60_000,
            "maximumModelCalls": 20,
            "maximumInspectionCount": 10,
        },
        "modelProfile": {
            "provider": "test",
            "model": "fake",
            "reasoningEffort": "none",
        },
    }


class FakeRunner:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, request, output_dir: Path) -> ExplorationResult:
        self.calls += 1
        output_dir.mkdir(parents=True, exist_ok=True)
        return ExplorationResult(
            schemaVersion="storm-exploration-result-v1",
            explorationId=request.exploration_id,
            status="complete",
            perspectives=[
                PerspectiveCandidate(
                    key="perspective-1",
                    title="Mechanisms",
                    rationale="Mechanism-oriented research perspective.",
                )
            ],
            questions=[
                QuestionCandidate(
                    key="question-1",
                    perspectiveKey="perspective-1",
                    question="Which reversible interactions control gelation?",
                )
            ],
            outlines=[
                OutlineCandidate(
                    key="outline-1",
                    title="Physical gel preparation",
                    sections=[
                        OutlineSectionCandidate(
                            heading="Mechanisms",
                            purpose="Compare reversible interactions.",
                            questionKeys=["question-1"],
                            sourceKeys=[],
                        )
                    ],
                )
            ],
        )


def test_api_worker_and_result_round_trip(tmp_path: Path) -> None:
    app = create_app(tmp_path / "store.sqlite3")
    client = TestClient(app)
    started = client.post("/v1/explorations", json=request_payload())
    assert started.status_code == 202
    remote_id = started.json()["remoteExecutionId"]

    repeated = client.post("/v1/explorations", json=request_payload())
    assert repeated.status_code == 202
    assert repeated.json()["remoteExecutionId"] == remote_id

    runner = FakeRunner()
    worker = ExplorationWorker(app.state.execution_store, runner, tmp_path / "outputs")
    assert worker.run_once() is True
    assert worker.run_once() is False
    assert runner.calls == 1

    status_response = client.get(f"/v1/explorations/{remote_id}")
    assert status_response.json()["status"] == "complete"
    result = client.get(f"/v1/explorations/{remote_id}/result")
    assert result.status_code == 200
    assert result.json()["schemaVersion"] == "storm-exploration-result-v1"
    assert result.json()["outlines"][0]["sections"][0]["heading"] == "Mechanisms"


def test_changed_request_with_same_id_conflicts(tmp_path: Path) -> None:
    app = create_app(tmp_path / "store.sqlite3")
    client = TestClient(app)
    assert client.post("/v1/explorations", json=request_payload()).status_code == 202
    changed = request_payload()
    changed["topic"] = "A different topic"
    response = client.post("/v1/explorations", json=changed)
    assert response.status_code == 409


def test_cancelled_queue_is_not_executed(tmp_path: Path) -> None:
    app = create_app(tmp_path / "store.sqlite3")
    client = TestClient(app)
    remote_id = client.post("/v1/explorations", json=request_payload()).json()[
        "remoteExecutionId"
    ]
    cancelled = client.post(f"/v1/explorations/{remote_id}/cancel")
    assert cancelled.json()["status"] == "cancelled"
    runner = FakeRunner()
    worker = ExplorationWorker(app.state.execution_store, runner, tmp_path / "outputs")
    assert worker.run_once() is False
    assert runner.calls == 0


def test_contract_rejects_unknown_fields(tmp_path: Path) -> None:
    app = create_app(tmp_path / "store.sqlite3")
    client = TestClient(app)
    payload = request_payload()
    payload["unexpected"] = True
    assert client.post("/v1/explorations", json=payload).status_code == 422


def test_health_exposes_runtime_gate_without_loading_storm(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("STORM_RUNTIME_APPROVED", "true")
    app = create_app(tmp_path / "store.sqlite3")
    payload = TestClient(app).get("/health").json()
    assert payload["status"] == "ok"
    assert payload["runtimeAdmissionStatus"] == "blocked"
    assert payload["runtimeApproved"] is False
    assert payload["productionReady"] is False


def test_environment_flag_cannot_bypass_blocked_admission(monkeypatch) -> None:
    monkeypatch.setenv("STORM_RUNTIME_APPROVED", "true")
    with pytest.raises(StormDependencyUnavailable, match="dependency audit"):
        create_real_runner()
