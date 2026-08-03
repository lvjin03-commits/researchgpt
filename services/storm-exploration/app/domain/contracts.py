from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TimeRange(StrictModel):
    from_year: int | None = Field(default=None, alias="fromYear", ge=1800, le=2200)
    to_year: int | None = Field(default=None, alias="toYear", ge=1800, le=2200)

    @model_validator(mode="after")
    def validate_order(self) -> "TimeRange":
        if self.from_year is not None and self.to_year is not None and self.from_year > self.to_year:
            raise ValueError("fromYear cannot be after toYear")
        return self


class ExplorationScope(StrictModel):
    time_range: TimeRange | None = Field(default=None, alias="timeRange")
    disciplines: list[str] = Field(default_factory=list, max_length=20)
    excluded_topics: list[str] = Field(default_factory=list, alias="excludedTopics", max_length=50)


class SourcePolicy(StrictModel):
    use_web: bool = Field(alias="useWeb")
    use_user_documents: bool = Field(alias="useUserDocuments")
    user_resource_ids: list[str] = Field(alias="userResourceIds", max_length=200)

    @model_validator(mode="after")
    def validate_sources(self) -> "SourcePolicy":
        if not self.use_web and not self.use_user_documents:
            raise ValueError("at least one source must be enabled")
        if not self.use_user_documents and self.user_resource_ids:
            raise ValueError("userResourceIds require useUserDocuments=true")
        return self


class ExplorationLimits(StrictModel):
    max_perspectives: int = Field(alias="maxPerspectives", ge=1, le=12)
    max_questions_per_perspective: int = Field(alias="maxQuestionsPerPerspective", ge=1, le=12)
    max_search_queries: int = Field(alias="maxSearchQueries", ge=1, le=200)
    max_sources: int = Field(alias="maxSources", ge=1, le=500)
    maximum_wall_time_ms: int = Field(alias="maximumWallTimeMs", ge=10_000, le=3_600_000)
    maximum_model_calls: int = Field(alias="maximumModelCalls", ge=1, le=500)
    maximum_inspection_count: int = Field(alias="maximumInspectionCount", ge=1, le=100)


class ModelProfile(StrictModel):
    provider: str = Field(min_length=1, max_length=160)
    model: str = Field(min_length=1, max_length=160)
    reasoning_effort: Literal["none", "low", "medium"] = Field(default="none", alias="reasoningEffort")


class ExplorationRequest(StrictModel):
    schema_version: Literal["storm-exploration-request-v1"] = Field(alias="schemaVersion")
    exploration_id: str = Field(alias="explorationId", min_length=1, max_length=160)
    topic: str = Field(min_length=3, max_length=1_000)
    purpose: Literal[
        "literature_review",
        "grant_topic_exploration",
        "field_landscape",
        "technology_comparison",
    ]
    language: Literal["zh", "en"]
    scope: ExplorationScope = Field(default_factory=ExplorationScope)
    source_policy: SourcePolicy = Field(alias="sourcePolicy")
    limits: ExplorationLimits
    model_profile: ModelProfile = Field(alias="modelProfile")
    user_resource_snapshot_hash: str | None = Field(
        default=None,
        alias="userResourceSnapshotHash",
        pattern=r"^[a-fA-F0-9]{64}$",
    )

    @model_validator(mode="after")
    def validate_user_snapshot(self) -> "ExplorationRequest":
        if self.source_policy.use_user_documents and not self.user_resource_snapshot_hash:
            raise ValueError("user-document exploration requires a frozen snapshot hash")
        return self


ExplorationStatus = Literal[
    "queued",
    "running",
    "partial",
    "complete",
    "failed",
    "unknown_outcome",
    "expired",
    "cancelled",
]


class FailurePayload(StrictModel):
    code: str = Field(min_length=1, max_length=160)
    category: Literal["contract", "provider", "infrastructure", "unknown_outcome"]
    retryability: Literal["none", "safe", "unknown"]
    technical_message: str = Field(alias="technicalMessage", min_length=1, max_length=8_000)
    user_message_code: str = Field(alias="userMessageCode", min_length=1, max_length=160)


class StartResponse(StrictModel):
    remote_execution_id: str = Field(alias="remoteExecutionId", min_length=1, max_length=160)
    status: Literal["queued", "running"]
    next_check_at: datetime | None = Field(default=None, alias="nextCheckAt")


class StatusResponse(StrictModel):
    remote_execution_id: str = Field(alias="remoteExecutionId", min_length=1, max_length=160)
    status: ExplorationStatus
    phase: str = Field(min_length=1, max_length=160)
    result_location: str | None = Field(default=None, alias="resultLocation", max_length=2_000)
    next_check_at: datetime | None = Field(default=None, alias="nextCheckAt")
    failure: FailurePayload | None = None


class PerspectiveCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=4_000)
    rationale: str = Field(min_length=1, max_length=12_000)


class QuestionCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    perspective_key: str = Field(alias="perspectiveKey", min_length=1, max_length=160)
    question: str = Field(min_length=1, max_length=4_000)
    importance: Literal["high", "medium", "low"] = "medium"
    follow_ups: list[str] = Field(default_factory=list, alias="followUps", max_length=20)


class SearchCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    question_key: str = Field(alias="questionKey", min_length=1, max_length=160)
    query: str = Field(min_length=1, max_length=4_000)
    source_type: Literal["web", "user_corpus"] = Field(alias="sourceType")


class SourceCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=4_000)
    url: HttpUrl | None = None
    doi: str | None = Field(default=None, max_length=300)
    authors: list[str] = Field(default_factory=list, max_length=100)
    year: int | None = Field(default=None, ge=1000, le=2200)
    snippet: str | None = Field(default=None, max_length=12_000)
    retrieved_by: str = Field(alias="retrievedBy", min_length=1, max_length=160)


class KnowledgeCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=4_000)
    summary: str = Field(min_length=1, max_length=12_000)
    parent_key: str | None = Field(default=None, alias="parentKey", max_length=160)
    source_keys: list[str] = Field(default_factory=list, alias="sourceKeys", max_length=100)


class OutlineSectionCandidate(StrictModel):
    heading: str = Field(min_length=1, max_length=4_000)
    purpose: str = Field(min_length=1, max_length=12_000)
    question_keys: list[str] = Field(default_factory=list, alias="questionKeys", max_length=100)
    source_keys: list[str] = Field(default_factory=list, alias="sourceKeys", max_length=100)


class OutlineCandidate(StrictModel):
    key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=4_000)
    sections: list[OutlineSectionCandidate] = Field(min_length=1, max_length=40)


class ProviderCallEvidence(StrictModel):
    provider: str = Field(min_length=1, max_length=160)
    kind: Literal["model", "search"]
    operation: str = Field(min_length=1, max_length=160)
    model: str | None = Field(default=None, max_length=160)
    provider_request_id: str | None = Field(
        default=None, alias="providerRequestId", max_length=500
    )
    status: Literal["succeeded", "failed", "unknown_outcome"]
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)
    estimated_cost_usd: float | None = Field(
        default=None, alias="estimatedCostUsd", ge=0
    )
    started_at: datetime = Field(alias="startedAt")
    finished_at: datetime = Field(alias="finishedAt")


class UsagePayload(StrictModel):
    model_calls: int = Field(default=0, alias="modelCalls", ge=0)
    search_calls: int = Field(default=0, alias="searchCalls", ge=0)
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)
    estimated_cost_usd: float | None = Field(default=None, alias="estimatedCostUsd", ge=0)
    provider_calls: list[ProviderCallEvidence] = Field(
        default_factory=list, alias="providerCalls", max_length=500
    )


class ExplorationResult(StrictModel):
    schema_version: Literal["storm-exploration-result-v1"] = Field(alias="schemaVersion")
    exploration_id: str = Field(alias="explorationId", min_length=1, max_length=160)
    status: Literal["complete", "partial", "failed"]
    perspectives: list[PerspectiveCandidate] = Field(default_factory=list, max_length=20)
    questions: list[QuestionCandidate] = Field(default_factory=list, max_length=200)
    searches: list[SearchCandidate] = Field(default_factory=list, max_length=500)
    sources: list[SourceCandidate] = Field(default_factory=list, max_length=1_000)
    knowledge: list[KnowledgeCandidate] = Field(default_factory=list, max_length=1_000)
    outlines: list[OutlineCandidate] = Field(default_factory=list, max_length=20)
    unresolved_questions: list[str] = Field(default_factory=list, alias="unresolvedQuestions", max_length=200)
    warnings: list[str] = Field(default_factory=list, max_length=200)
    usage: UsagePayload = Field(default_factory=UsagePayload)
