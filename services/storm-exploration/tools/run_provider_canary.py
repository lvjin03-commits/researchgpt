from __future__ import annotations

import argparse
import json
import os
import signal
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.domain.contracts import ExplorationRequest
from app.storm_adapter.provider_runner import (
    ProviderBackedStormExplorationRunner,
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
    try:
        result = ProviderBackedStormExplorationRunner(config).run(
            request,
            evidence_directory,
        )
    finally:
        signal.alarm(0)

    calls = result.usage.provider_calls
    missing_request_ids = [
        call.operation
        for call in calls
        if call.status == "succeeded" and not call.provider_request_id
    ]
    report = {
        "schemaVersion": "storm-provider-canary-report-v1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "nonAuthoritative": True,
        "published": False,
        "explorationId": request.exploration_id,
        "evidenceDirectory": str(evidence_directory),
        "resultStatus": result.status,
        "counts": {
            "perspectives": len(result.perspectives),
            "questions": len(result.questions),
            "sources": len(result.sources),
            "outlines": len(result.outlines),
        },
        "usage": result.usage.model_dump(mode="json", by_alias=True),
        "missingProviderRequestIds": missing_request_ids,
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if not calls:
        raise RuntimeError("Canary completed without provider call evidence.")
    if missing_request_ids:
        raise RuntimeError(
            "Canary provider calls did not expose all required request IDs."
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
