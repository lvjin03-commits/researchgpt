from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.domain.contracts import (
    ExplorationRequest,
    ExplorationResult,
    KnowledgeCandidate,
    OutlineCandidate,
    OutlineSectionCandidate,
    PerspectiveCandidate,
    QuestionCandidate,
    SourceCandidate,
    UsagePayload,
)


class ExplorationRunner(Protocol):
    def run(self, request: ExplorationRequest, output_dir: Path) -> ExplorationResult: ...


def safe_topic(topic: str) -> str:
    normalized = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", topic, flags=re.UNICODE)
    return normalized.strip("-")[:80] or "research-topic"


def _read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def _extract_outline(text: str, topic: str) -> OutlineCandidate | None:
    headings: list[str] = []
    for line in text.splitlines():
        value = re.sub(r"^\s*(?:#{1,6}\s*|\d+(?:\.\d+)*[.)]?\s*)", "", line).strip()
        if value and len(value) <= 500:
            headings.append(value)
    if not headings:
        return None
    title, *section_headings = headings
    if not section_headings:
        section_headings = headings
        title = topic
    return OutlineCandidate(
        key="storm-outline-1",
        title=title,
        sections=[
            OutlineSectionCandidate(
                heading=heading,
                purpose=f"Research and synthesize evidence for {heading}.",
                questionKeys=[],
                sourceKeys=[],
            )
            for heading in section_headings[:40]
        ],
    )


def adapt_storm_outputs(
    request: ExplorationRequest,
    output_dir: Path,
    usage: UsagePayload | None = None,
) -> ExplorationResult:
    conversation = _read_json(output_dir / "conversation_log.json", [])
    raw_sources = _read_json(output_dir / "raw_search_results.json", {})
    outline_text = _read_text(output_dir / "storm_gen_outline.txt") or _read_text(
        output_dir / "direct_gen_outline.txt"
    )

    perspectives: list[PerspectiveCandidate] = []
    questions: list[QuestionCandidate] = []
    knowledge: list[KnowledgeCandidate] = []
    if isinstance(conversation, list):
        for perspective_index, item in enumerate(conversation[: request.limits.max_perspectives], 1):
            if not isinstance(item, dict):
                continue
            perspective = str(item.get("perspective") or item.get("role") or f"Perspective {perspective_index}")
            perspective_key = f"perspective-{perspective_index}"
            perspectives.append(
                PerspectiveCandidate(key=perspective_key, title=perspective, rationale=perspective)
            )
            turns = item.get("dlg_turns") or item.get("dialogue") or item.get("turns") or []
            if not isinstance(turns, list):
                continue
            for question_index, turn in enumerate(
                turns[: request.limits.max_questions_per_perspective], 1
            ):
                if not isinstance(turn, dict):
                    continue
                question = str(turn.get("user_utterance") or turn.get("question") or "").strip()
                answer = str(turn.get("agent_utterance") or turn.get("answer") or "").strip()
                if not question:
                    continue
                question_key = f"question-{perspective_index}-{question_index}"
                questions.append(
                    QuestionCandidate(
                        key=question_key,
                        perspectiveKey=perspective_key,
                        question=question,
                        importance="medium",
                        followUps=[],
                    )
                )
                if answer:
                    knowledge.append(
                        KnowledgeCandidate(
                            key=f"knowledge-{perspective_index}-{question_index}",
                            title=question,
                            summary=answer[:12_000],
                            sourceKeys=[],
                        )
                    )

    sources: list[SourceCandidate] = []
    iterable = raw_sources.items() if isinstance(raw_sources, dict) else enumerate(raw_sources) if isinstance(raw_sources, list) else []
    for source_index, (_, item) in enumerate(iterable, 1):
        if source_index > request.limits.max_sources or not isinstance(item, dict):
            break
        url = item.get("url")
        title = str(item.get("title") or url or f"Source {source_index}").strip()
        if not title:
            continue
        try:
            sources.append(
                SourceCandidate(
                    key=f"source-{source_index}",
                    title=title,
                    url=url or None,
                    snippet=(str(item.get("description") or item.get("snippet") or "").strip() or None),
                    retrievedBy="storm",
                )
            )
        except ValueError:
            sources.append(
                SourceCandidate(
                    key=f"source-{source_index}",
                    title=title,
                    snippet=(str(item.get("description") or item.get("snippet") or "").strip() or None),
                    retrievedBy="storm",
                )
            )

    outline = _extract_outline(outline_text, request.topic)
    warnings: list[str] = []
    if not perspectives:
        warnings.append("STORM did not emit parseable perspective candidates.")
    if not questions:
        warnings.append("STORM did not emit parseable research-question candidates.")
    if not outline:
        warnings.append("STORM did not emit a parseable outline candidate.")
    complete = bool(perspectives and questions and outline)
    return ExplorationResult(
        schemaVersion="storm-exploration-result-v1",
        explorationId=request.exploration_id,
        status="complete" if complete else "partial",
        perspectives=perspectives,
        questions=questions,
        searches=[],
        sources=sources,
        knowledge=knowledge,
        outlines=[outline] if outline else [],
        unresolvedQuestions=[],
        warnings=warnings,
        usage=usage or UsagePayload(),
    )


def _collect_usage(runner: object) -> UsagePayload:
    model_calls = 0
    input_tokens = 0
    output_tokens = 0
    estimated_cost = 0.0
    lm_configs = getattr(runner, "lm_configs", None)
    if lm_configs is not None:
        usage_by_model = lm_configs.collect_and_reset_lm_usage()
        for usage in usage_by_model.values():
            input_tokens += int(usage.get("prompt_tokens", 0) or 0)
            output_tokens += int(usage.get("completion_tokens", 0) or 0)
        history = lm_configs.collect_and_reset_lm_history()
        model_calls = len(history)
        estimated_cost = sum(
            float(entry.get("cost") or 0)
            for entry in history
            if isinstance(entry, dict)
        )
    search_calls = 0
    retriever = getattr(runner, "retriever", None)
    if retriever is not None and hasattr(retriever, "collect_and_reset_rm_usage"):
        search_calls = sum(retriever.collect_and_reset_rm_usage().values())
    collector = getattr(runner, "_researchgpt_provider_evidence", None)
    provider_calls = collector.snapshot() if collector is not None else []
    return UsagePayload(
        modelCalls=model_calls,
        searchCalls=search_calls,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        estimatedCostUsd=estimated_cost,
        providerCalls=provider_calls,
    )


@dataclass(frozen=True)
class StormWikiExplorationRunner:
    runner: object

    def run(self, request: ExplorationRequest, output_dir: Path) -> ExplorationResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        setattr(self.runner, "article_output_dir", str(output_dir))
        self.runner.run(  # type: ignore[attr-defined]
            topic=request.topic,
            do_research=True,
            do_generate_outline=True,
            do_generate_article=False,
            do_polish_article=False,
            remove_duplicate=False,
        )
        actual_output_dir = Path(
            getattr(self.runner, "article_output_dir", str(output_dir))
        )
        return adapt_storm_outputs(
            request,
            actual_output_dir,
            usage=_collect_usage(self.runner),
        )
