from __future__ import annotations

import pytest

from app.storm_adapter.provider_runner import StormProviderConfig
from tools.run_provider_canary import (
    CANARY_MAX_MODEL_CALLS,
    CANARY_MAX_SEARCH_QUERIES,
    CanaryNotApproved,
    build_canary_request,
    require_canary_approval,
)


def config() -> StormProviderConfig:
    return StormProviderConfig(
        request_provider="deepseek",
        request_model="deepseek-chat",
        question_model="deepseek/deepseek-chat",
        outline_model="deepseek/deepseek-chat",
        llm_api_key="secret",
        llm_api_base="https://api.deepseek.com",
        search_provider="tavily",
        search_api_key="secret",
        request_timeout_seconds=60,
        max_threads=2,
        max_model_calls=CANARY_MAX_MODEL_CALLS,
        max_search_queries=CANARY_MAX_SEARCH_QUERIES,
    )


def test_canary_refuses_to_run_without_explicit_approval(monkeypatch) -> None:
    monkeypatch.delenv("STORM_CANARY_APPROVED", raising=False)
    with pytest.raises(CanaryNotApproved):
        require_canary_approval()


def test_canary_request_is_web_only_and_cost_bounded() -> None:
    request = build_canary_request(config(), "Physical gels")
    assert request.source_policy.use_web is True
    assert request.source_policy.use_user_documents is False
    assert request.limits.max_perspectives == 1
    assert request.limits.max_questions_per_perspective == 1
    assert request.limits.maximum_model_calls == CANARY_MAX_MODEL_CALLS
    assert request.limits.max_search_queries == CANARY_MAX_SEARCH_QUERIES
