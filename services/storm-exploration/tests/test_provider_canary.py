from __future__ import annotations

import pytest
from datetime import UTC, datetime

from app.domain.contracts import ProviderCallEvidence
from app.storm_adapter.provider_runner import StormProviderConfig
from tools.run_provider_canary import (
    CANARY_MAX_MODEL_CALLS,
    CANARY_MAX_SEARCH_QUERIES,
    CanaryNotApproved,
    _usage_from_calls,
    _validate_provider_evidence,
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


def test_budget_boundary_is_admissible_with_complete_provider_evidence() -> None:
    now = datetime.now(UTC)
    calls = [
        ProviderCallEvidence(
            provider="deepseek",
            kind="model",
            operation="research_question",
            model="deepseek-chat",
            providerRequestId="deepseek-request-1",
            status="succeeded",
            inputTokens=10,
            outputTokens=5,
            estimatedCostUsd=0.001,
            startedAt=now,
            finishedAt=now,
        ),
        ProviderCallEvidence(
            provider="tavily",
            kind="search",
            operation="search",
            providerRequestId="tavily-request-1",
            status="succeeded",
            startedAt=now,
            finishedAt=now,
        ),
    ]

    assert not any(_validate_provider_evidence(calls).values())
    assert _usage_from_calls(calls)["modelCalls"] == 1
    assert _usage_from_calls(calls)["searchCalls"] == 1


def test_canary_rejects_missing_provider_kind_or_request_id() -> None:
    now = datetime.now(UTC)
    calls = [
        ProviderCallEvidence(
            provider="deepseek",
            kind="model",
            operation="research_question",
            status="succeeded",
            startedAt=now,
            finishedAt=now,
        )
    ]

    validation = _validate_provider_evidence(calls)
    assert validation["missingProviderRequestIds"] == ["research_question"]
    assert validation["missingProviderKinds"] == ["search"]
