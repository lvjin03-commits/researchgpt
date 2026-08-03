from __future__ import annotations

import pytest

from app.storm_adapter.provider_runner import (
    SharedCallBudget,
    StormBudgetExceeded,
    StormProviderConfig,
    StormProviderConfigurationError,
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


def test_missing_provider_setting_fails_before_call(monkeypatch) -> None:
    configure_environment(monkeypatch)
    monkeypatch.delenv("STORM_SEARCH_API_KEY")

    with pytest.raises(StormProviderConfigurationError, match="STORM_SEARCH_API_KEY"):
        StormProviderConfig.from_environment()
