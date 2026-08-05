from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.domain.contracts import ProviderCallEvidence
from app.storm_adapter.provider_runner import (
    EvidenceSearchClient,
    ProviderEvidenceCollector,
    SharedCallBudget,
    StormBudgetExceeded,
    StormProviderConfig,
    StormProviderConfigurationError,
    queries_per_conversation_turn,
    required_model_calls,
)
from tests.test_runner_boundary import request


def configure_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "STORM_REQUEST_PROVIDER": "deepseek",
        "STORM_REQUEST_MODEL": "deepseek-chat",
        "STORM_QUESTION_LITELLM_MODEL": "deepseek/deepseek-chat",
        "STORM_OUTLINE_LITELLM_MODEL": "deepseek/deepseek-chat",
        "STORM_LLM_API_KEY": "private-llm-key",
        "STORM_SEARCH_PROVIDER": "tavily",
        "STORM_SEARCH_API_KEY": "private-search-key",
        "STORM_MAX_MODEL_CALLS": "40",
        "STORM_MAX_SEARCH_QUERIES": "40",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_provider_config_is_explicit_and_redacts_secrets(monkeypatch) -> None:
    configure_environment(monkeypatch)
    config = StormProviderConfig.from_environment()

    rendered = repr(config)
    assert config.request_provider == "deepseek"
    assert "private-llm-key" not in rendered
    assert "private-search-key" not in rendered


def test_provider_config_rejects_profile_mismatch(monkeypatch) -> None:
    configure_environment(monkeypatch)
    config = StormProviderConfig.from_environment()

    with pytest.raises(StormProviderConfigurationError, match="provider"):
        config.validate_request(request())


def test_provider_config_accepts_frozen_profile_within_budget(monkeypatch) -> None:
    configure_environment(monkeypatch)
    config = StormProviderConfig.from_environment()
    payload = request().model_dump(mode="json", by_alias=True)
    payload["modelProfile"] = {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "reasoningEffort": "none",
    }

    config.validate_request(type(request()).model_validate(payload))


def test_shared_call_budget_is_hard_and_thread_safe() -> None:
    budget = SharedCallBudget(2)
    budget.consume()
    budget.consume()

    with pytest.raises(StormBudgetExceeded, match="exhausted"):
        budget.consume()


def test_shared_call_budget_rejects_batch_overrun() -> None:
    budget = SharedCallBudget(3, label="search-query")
    budget.consume(2)

    with pytest.raises(StormBudgetExceeded, match="search-query"):
        budget.consume(2)


def test_search_budget_reserves_the_perspective_discovery_round() -> None:
    assert queries_per_conversation_turn(2, perspectives=1, turns=1) == 1
    assert queries_per_conversation_turn(8, perspectives=1, turns=1) == 4
    assert queries_per_conversation_turn(8, perspectives=2, turns=1) == 2


def test_model_budget_includes_default_persona_and_outline_calls() -> None:
    assert required_model_calls(perspectives=1, turns=1) == 10
    assert required_model_calls(perspectives=3, turns=3) == 40


def test_missing_provider_setting_fails_before_call(monkeypatch) -> None:
    configure_environment(monkeypatch)
    monkeypatch.delenv("STORM_SEARCH_API_KEY")

    with pytest.raises(StormProviderConfigurationError, match="STORM_SEARCH_API_KEY"):
        StormProviderConfig.from_environment()


def test_provider_evidence_is_persisted_without_prompts_or_secrets(tmp_path) -> None:
    collector = ProviderEvidenceCollector(tmp_path / "provider-calls.jsonl")
    now = datetime.now(UTC)
    collector.record(
        ProviderCallEvidence(
            provider="deepseek",
            kind="model",
            operation="outline_generation",
            model="deepseek-chat",
            providerRequestId="request-123",
            status="succeeded",
            inputTokens=12,
            outputTokens=7,
            estimatedCostUsd=0.001,
            startedAt=now,
            finishedAt=now,
        )
    )

    stored = (tmp_path / "provider-calls.jsonl").read_text(encoding="utf-8")
    assert "request-123" in stored
    assert "prompt" not in stored.lower()
    assert collector.snapshot()[0].estimated_cost_usd == 0.001


class FakeSearchClient:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail

    def search(self, query: str) -> dict:
        if self.should_fail:
            raise TimeoutError("provider result unknown")
        return {"request_id": "tavily-request-1", "results": []}


def test_search_proxy_records_request_id_and_unknown_outcome(tmp_path) -> None:
    collector = ProviderEvidenceCollector(tmp_path / "provider-calls.jsonl")
    proxy = EvidenceSearchClient(FakeSearchClient(), collector, "tavily")
    assert proxy.search("gel") == {
        "request_id": "tavily-request-1",
        "results": [],
    }
    assert collector.snapshot()[0].provider_request_id == "tavily-request-1"

    failing = EvidenceSearchClient(FakeSearchClient(True), collector, "tavily")
    with pytest.raises(TimeoutError):
        failing.search("gel")
    assert collector.snapshot()[1].status == "unknown_outcome"
