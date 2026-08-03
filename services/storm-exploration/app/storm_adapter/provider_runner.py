from __future__ import annotations

import json
import math
import os
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.domain.contracts import (
    ExplorationRequest,
    ExplorationResult,
    ProviderCallEvidence,
)
from app.storm_adapter.runner import StormWikiExplorationRunner


class StormProviderConfigurationError(RuntimeError):
    pass


class StormBudgetExceeded(RuntimeError):
    pass


class ProviderEvidenceCollector:
    """Persist non-secret provider evidence as each remote call resolves."""

    def __init__(self, journal_path: Path) -> None:
        journal_path.parent.mkdir(parents=True, exist_ok=True)
        self.journal_path = journal_path
        self._calls: list[ProviderCallEvidence] = []
        self._lock = threading.Lock()

    def record(self, evidence: ProviderCallEvidence) -> None:
        payload = evidence.model_dump(mode="json", by_alias=True)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n"
        with self._lock:
            with self.journal_path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            self._calls.append(evidence)

    def snapshot(self) -> list[ProviderCallEvidence]:
        with self._lock:
            return list(self._calls)


def _request_id(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("id", "request_id", "requestId"):
        value = response.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()[:500]
    return None


class EvidenceSearchClient:
    def __init__(
        self,
        client: object,
        collector: ProviderEvidenceCollector,
        provider: str,
    ) -> None:
        self._client = client
        self._collector = collector
        self._provider = provider

    def search(self, *args, **kwargs):
        started_at = datetime.now(UTC)
        try:
            response = self._client.search(*args, **kwargs)  # type: ignore[attr-defined]
        except Exception:
            self._collector.record(
                ProviderCallEvidence(
                    provider=self._provider,
                    kind="search",
                    operation="search",
                    status="unknown_outcome",
                    startedAt=started_at,
                    finishedAt=datetime.now(UTC),
                )
            )
            raise
        self._collector.record(
            ProviderCallEvidence(
                provider=self._provider,
                kind="search",
                operation="search",
                providerRequestId=_request_id(response),
                status="succeeded",
                startedAt=started_at,
                finishedAt=datetime.now(UTC),
            )
        )
        return response


def _required_environment(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise StormProviderConfigurationError(f"Missing required setting: {name}")
    return value


def _bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise StormProviderConfigurationError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise StormProviderConfigurationError(
            f"{name} must be between {minimum} and {maximum}"
        )
    return value


@dataclass(frozen=True)
class StormProviderConfig:
    request_provider: str
    request_model: str
    question_model: str
    outline_model: str
    llm_api_key: str = field(repr=False)
    llm_api_base: str | None
    search_provider: str
    search_api_key: str = field(repr=False)
    request_timeout_seconds: int
    max_threads: int
    max_model_calls: int
    max_search_queries: int

    @classmethod
    def from_environment(cls) -> "StormProviderConfig":
        search_provider = _required_environment("STORM_SEARCH_PROVIDER").lower()
        if search_provider != "tavily":
            raise StormProviderConfigurationError(
                "STORM_SEARCH_PROVIDER must be tavily in runtime v1"
            )
        api_base = os.getenv("STORM_LLM_API_BASE", "").strip() or None
        return cls(
            request_provider=_required_environment("STORM_REQUEST_PROVIDER"),
            request_model=_required_environment("STORM_REQUEST_MODEL"),
            question_model=_required_environment("STORM_QUESTION_LITELLM_MODEL"),
            outline_model=_required_environment("STORM_OUTLINE_LITELLM_MODEL"),
            llm_api_key=_required_environment("STORM_LLM_API_KEY"),
            llm_api_base=api_base,
            search_provider=search_provider,
            search_api_key=_required_environment("STORM_SEARCH_API_KEY"),
            request_timeout_seconds=_bounded_integer(
                "STORM_PROVIDER_TIMEOUT_SECONDS", 60, 5, 180
            ),
            max_threads=_bounded_integer("STORM_MAX_THREADS", 4, 1, 8),
            max_model_calls=_bounded_integer("STORM_MAX_MODEL_CALLS", 40, 1, 100),
            max_search_queries=_bounded_integer(
                "STORM_MAX_SEARCH_QUERIES", 40, 1, 100
            ),
        )

    def validate_request(self, request: ExplorationRequest) -> None:
        if request.model_profile.provider != self.request_provider:
            raise StormProviderConfigurationError(
                "The requested provider is not admitted by this STORM runtime"
            )
        if request.model_profile.model != self.request_model:
            raise StormProviderConfigurationError(
                "The requested model is not admitted by this STORM runtime"
            )
        if request.source_policy.use_user_documents:
            raise StormProviderConfigurationError(
                "User-document retrieval is not admitted by STORM runtime v1"
            )
        if not request.source_policy.use_web:
            raise StormProviderConfigurationError(
                "STORM runtime v1 requires web retrieval"
            )
        if request.limits.maximum_model_calls > self.max_model_calls:
            raise StormProviderConfigurationError(
                "The requested model-call budget exceeds the service limit"
            )
        if request.limits.max_search_queries > self.max_search_queries:
            raise StormProviderConfigurationError(
                "The requested search budget exceeds the service limit"
            )


class SharedCallBudget:
    def __init__(self, maximum: int, label: str = "model-call") -> None:
        self.maximum = maximum
        self.label = label
        self.used = 0
        self._lock = threading.Lock()

    def consume(self, amount: int = 1) -> None:
        with self._lock:
            if amount < 1 or self.used + amount > self.maximum:
                raise StormBudgetExceeded(
                    f"The STORM {self.label} budget was exhausted"
                )
            self.used += amount


@dataclass(frozen=True)
class ProviderBackedStormExplorationRunner:
    config: StormProviderConfig

    def run(self, request: ExplorationRequest, output_dir: Path) -> ExplorationResult:
        self.config.validate_request(request)
        collector = ProviderEvidenceCollector(output_dir / "provider-calls.jsonl")
        upstream = self._create_upstream_runner(request, output_dir, collector)
        setattr(upstream, "_researchgpt_provider_evidence", collector)
        return StormWikiExplorationRunner(upstream).run(request, output_dir)

    def _create_upstream_runner(
        self,
        request: ExplorationRequest,
        output_dir: Path,
        collector: ProviderEvidenceCollector | None = None,
    ):
        from knowledge_storm import (
            STORMWikiLMConfigs,
            STORMWikiRunner,
            STORMWikiRunnerArguments,
        )
        from knowledge_storm.lm import LitellmModel
        from knowledge_storm.rm import TavilySearchRM

        model_budget = SharedCallBudget(
            request.limits.maximum_model_calls, label="model-call"
        )
        search_budget = SharedCallBudget(
            request.limits.max_search_queries, label="search-query"
        )
        collector = collector or ProviderEvidenceCollector(
            output_dir / "provider-calls.jsonl"
        )
        model_provider = self.config.request_provider

        class BudgetedLitellmModel(LitellmModel):
            def __init__(self, *args, operation: str, **kwargs):
                self._researchgpt_operation = operation
                super().__init__(*args, **kwargs)

            def __call__(self, prompt=None, messages=None, **kwargs):
                model_budget.consume()
                started_at = datetime.now(UTC)
                try:
                    outputs = super().__call__(
                        prompt=prompt,
                        messages=messages,
                        **kwargs,
                    )
                except Exception:
                    collector.record(
                        ProviderCallEvidence(
                            provider=model_provider,
                            kind="model",
                            operation=self._researchgpt_operation,
                            model=str(getattr(self, "model", "")) or None,
                            status="unknown_outcome",
                            startedAt=started_at,
                            finishedAt=datetime.now(UTC),
                        )
                    )
                    raise
                history_entry = self.history[-1] if self.history else {}
                response = history_entry.get("response", {})
                usage = response.get("usage", {}) if isinstance(response, dict) else {}
                collector.record(
                    ProviderCallEvidence(
                        provider=model_provider,
                        kind="model",
                        operation=self._researchgpt_operation,
                        model=str(getattr(self, "model", "")) or None,
                        providerRequestId=_request_id(response),
                        status="succeeded",
                        inputTokens=int(usage.get("prompt_tokens", 0) or 0),
                        outputTokens=int(usage.get("completion_tokens", 0) or 0),
                        estimatedCostUsd=(
                            float(history_entry["cost"])
                            if history_entry.get("cost") is not None
                            else None
                        ),
                        startedAt=started_at,
                        finishedAt=datetime.now(UTC),
                    )
                )
                return outputs

        class BudgetedTavilySearchRM(TavilySearchRM):
            def forward(self, query_or_queries, exclude_urls=None):
                queries = (
                    [query_or_queries]
                    if isinstance(query_or_queries, str)
                    else query_or_queries
                )
                search_budget.consume(len(queries))
                return super().forward(
                    query_or_queries=query_or_queries,
                    exclude_urls=exclude_urls or [],
                )

        shared_kwargs = {
            "api_key": self.config.llm_api_key,
            "timeout": self.config.request_timeout_seconds,
            "cache": False,
            "temperature": 0.2,
        }
        if self.config.llm_api_base:
            shared_kwargs["api_base"] = self.config.llm_api_base
        question_model = BudgetedLitellmModel(
            model=self.config.question_model,
            max_tokens=800,
            operation="research_question",
            **shared_kwargs,
        )
        outline_model = BudgetedLitellmModel(
            model=self.config.outline_model,
            max_tokens=1_600,
            operation="outline_generation",
            **shared_kwargs,
        )
        lm_configs = STORMWikiLMConfigs()
        lm_configs.set_conv_simulator_lm(question_model)
        lm_configs.set_question_asker_lm(question_model)
        lm_configs.set_outline_gen_lm(outline_model)
        # Upstream validates these slots during construction even though the
        # ResearchGPT boundary never invokes article generation or polishing.
        lm_configs.set_article_gen_lm(outline_model)
        lm_configs.set_article_polish_lm(outline_model)

        perspectives = request.limits.max_perspectives
        turns = request.limits.max_questions_per_perspective
        queries_per_turn = max(
            1,
            math.ceil(request.limits.max_search_queries / (perspectives * turns)),
        )
        search_top_k = max(
            1,
            min(5, math.ceil(request.limits.max_sources / request.limits.max_search_queries)),
        )
        arguments = STORMWikiRunnerArguments(
            output_dir=str(output_dir),
            max_conv_turn=turns,
            max_perspective=perspectives,
            max_search_queries_per_turn=queries_per_turn,
            search_top_k=search_top_k,
            max_thread_num=self.config.max_threads,
        )
        retriever = BudgetedTavilySearchRM(
            tavily_search_api_key=self.config.search_api_key,
            k=search_top_k,
            webpage_helper_max_threads=self.config.max_threads,
            include_raw_content=False,
        )
        retriever.tavily_client = EvidenceSearchClient(
            retriever.tavily_client,
            collector,
            self.config.search_provider,
        )
        return STORMWikiRunner(arguments, lm_configs, retriever)
