from __future__ import annotations

import tempfile
from pathlib import Path

from app.domain.contracts import ExplorationRequest
from app.storm_adapter.provider_runner import (
    ProviderBackedStormExplorationRunner,
    StormProviderConfig,
)


def main() -> None:
    config = StormProviderConfig(
        request_provider="deepseek",
        request_model="deepseek-chat",
        question_model="deepseek/deepseek-chat",
        outline_model="deepseek/deepseek-chat",
        llm_api_key="non-network-preflight-key",
        llm_api_base="https://api.deepseek.com",
        search_provider="tavily",
        search_api_key="non-network-preflight-key",
        request_timeout_seconds=30,
        max_threads=2,
        max_model_calls=20,
        max_search_queries=20,
    )
    request = ExplorationRequest.model_validate(
        {
            "schemaVersion": "storm-exploration-request-v1",
            "explorationId": "provider-preflight",
            "topic": "Physical gel preparation",
            "purpose": "literature_review",
            "language": "en",
            "sourcePolicy": {
                "useWeb": True,
                "useUserDocuments": False,
                "userResourceIds": [],
            },
            "limits": {
                "maxPerspectives": 2,
                "maxQuestionsPerPerspective": 2,
                "maxSearchQueries": 8,
                "maxSources": 12,
                "maximumWallTimeMs": 60_000,
                "maximumModelCalls": 20,
                "maximumInspectionCount": 5,
            },
            "modelProfile": {
                "provider": "deepseek",
                "model": "deepseek-chat",
            },
        }
    )
    provider_runner = ProviderBackedStormExplorationRunner(config)
    with tempfile.TemporaryDirectory(prefix="storm-provider-preflight-") as directory:
        upstream = provider_runner._create_upstream_runner(request, Path(directory))
    assert upstream.args.max_perspective == 2
    assert upstream.args.max_conv_turn == 2
    assert upstream.args.max_thread_num == 2
    assert upstream.retriever.rm.__class__.__name__ == "BudgetedTavilySearchRM"
    assert upstream.lm_configs.outline_gen_lm.model == "deepseek/deepseek-chat"
    print("STORM provider wiring preflight passed without external calls.")


if __name__ == "__main__":
    main()
