from __future__ import annotations

import argparse
import json
import os
import signal
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.domain.contracts import ExplorationRequest, ProviderCallEvidence
from app.storm_adapter.provider_runner import (
    ProviderBackedStormExplorationRunner,
    StormBudgetExceeded,
    StormProviderConfig,
)
from app.storm_adapter.runner_factory import prepare_upstream_runtime_environment


CANARY_MAX_MODEL_CALLS = 8
CANARY_MAX_SEARCH_QUERIES = 2
CANARY_MAX_WALL_SECONDS = 180


class CanaryNotApproved(RuntimeError):
    pass


def require_canary_approval() -> None:
    if os.getenv("STORM_CANARY_APPROVED", "").lower() != "true":
        raise CanaryNotApproved(
            "Set STORM_CANARY_APPROVED=true only for an explicitly authorized canary."
        )


def build_canary_request(config: StormProviderConfig, topic: str) -> ExplorationRequest:
    return ExplorationRequest.model_validate(
        {
            "schemaVersion": "storm-exploration-request-v1",
            "explorationId": f"storm-canary-{uuid4()}",
            "topic": topic,
            "purpose": "literature_review",
            "language": "en",
            "scope": {"disciplines": [], "excludedTopics": []},
            "sourcePolicy": {
                "useWeb": True,
                "useUserDocuments": False,
                "userResourceIds": [],
            },
            "limits": {
                "maxPerspectives": 1,
                "maxQuestionsPerPerspective": 1,
                "maxSearchQueries": CANARY_MAX_SEARCH_QUERIES,
                "maxSources": 3,
                "maximumWallTimeMs": CANARY_MAX_WALL_SECONDS * 1_000,
                "maximumModelCalls": CANARY_MAX_MODEL_CALLS,
                "maximumInspectionCount": 3,
            },
            "modelProfile": {
                "provider": config.request_provider,
                "model": config.request_model,
                "reasoningEffort": "none",
            },
        }
    )


def _timeout_handler(signum, frame) -> None:
    raise TimeoutError("STORM provider canary exceeded its hard wall-time limit")


def _read_provider_calls(journal_path: Path) -> list[ProviderCallEvidence]:
    if not journal_path.exists():
        return []
    return [
        ProviderCallEvidence.model_validate_json(line)
        for line in journal_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _usage_from_calls(calls: list[ProviderCallEvidence]) -> dict[str, object]:
    costs = [call.estimated_cost_usd for call in calls if call.estimated_cost_usd]
    return {
        "modelCalls": sum(call.kind == "model" for call in calls),
        "searchCalls": sum(call.kind == "search" for call in calls),
        "inputTokens": sum(call.input_tokens or 0 for call in calls),
        "outputTokens": sum(call.output_tokens or 0 for call in calls),
        "estimatedCostUsd": sum(costs) if costs else None,
        "providerCalls": [
            call.model_dump(mode="json", by_alias=True) for call in calls
        ],
    }


def _validate_provider_evidence(calls: list[ProviderCallEvidence]) -> dict[str, list[str]]:
    missing_request_ids = [
        call.operation
        for call in calls
        if call.status == "succeeded" and not call.provider_request_id
    ]
    unsafe_outcomes = [
        call.operation for call in calls if call.status != "succeeded"
    ]
    observed_kinds = {call.kind for call in calls if call.status == "succeeded"}
    missing_provider_kinds = sorted({"model", "search"} - observed_kinds)
    return {
        "missingProviderRequestIds": missing_request_ids,
        "unsafeProviderOutcomes": unsafe_outcomes,
        "missingProviderKinds": missing_provider_kinds,
    }


def run_canary(topic: str, report_path: Path) -> dict[str, object]:
    require_canary_approval()
    if not hasattr(signal, "SIGALRM"):
        raise RuntimeError("The credentialed canary must run in the Linux image.")
    prepare_upstream_runtime_environment()
    config = StormProviderConfig.from_environment()
    request = build_canary_request(config, topic)
    config.validate_request(request)

    report_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_directory = report_path.parent / request.exploration_id
    evidence_directory.mkdir(parents=True, exist_ok=False)
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(CANARY_MAX_WALL_SECONDS)
    result = None
    controlled_stop_reason = None
    try:
        try:
            result = ProviderBackedStormExplorationRunner(config).run(
                request,
                evidence_directory,
            )
        except StormBudgetExceeded as error:
            controlled_stop_reason = str(error)
    finally:
        signal.alarm(0)

    journal_path = evidence_directory / "provider-calls.jsonl"
    calls = result.usage.provider_calls if result is not None else _read_provider_calls(journal_path)
    evidence_validation = _validate_provider_evidence(calls)
    counts = (
        {
            "perspectives": len(result.perspectives),
            "questions": len(result.questions),
            "sources": len(result.sources),
            "outlines": len(result.outlines),
        }
        if result is not None
        else None
    )
    report = {
        "schemaVersion": "storm-provider-canary-report-v1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "nonAuthoritative": True,
        "published": False,
        "explorationId": request.exploration_id,
        "evidenceDirectory": str(evidence_directory),
        "resultStatus": (
            result.status if result is not None else "budget_boundary_reached"
        ),
        "controlledStopReason": controlled_stop_reason,
        "counts": counts,
        "usage": (
            result.usage.model_dump(mode="json", by_alias=True)
            if result is not None
            else _usage_from_calls(calls)
        ),
        **evidence_validation,
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if not calls:
        raise RuntimeError("Canary completed without provider call evidence.")
    if any(evidence_validation.values()):
        raise RuntimeError(
            "Canary provider evidence did not satisfy the admission contract."
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--topic",
        default="Reversible physical gel preparation mechanisms",
    )
    parser.add_argument("--report", type=Path, default=Path("/data/canary-report.json"))
    args = parser.parse_args()
    report = run_canary(args.topic, args.report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
