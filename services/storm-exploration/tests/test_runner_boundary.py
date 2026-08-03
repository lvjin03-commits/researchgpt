from __future__ import annotations

from pathlib import Path

from app.domain.contracts import ExplorationRequest
from app.storm_adapter.runner import StormWikiExplorationRunner


class RecordingStormRunner:
    def __init__(self) -> None:
        self.article_output_dir = ""
        self.arguments = None

    def run(self, **kwargs) -> None:
        self.arguments = kwargs
        output = Path(self.article_output_dir)
        output.mkdir(parents=True, exist_ok=True)
        (output / "conversation_log.json").write_text(
            '[{"perspective":"Mechanisms","dlg_turns":[{"user_utterance":"What controls gelation?","agent_utterance":"Reversible interactions."}]}]',
            encoding="utf-8",
        )
        (output / "raw_search_results.json").write_text("{}", encoding="utf-8")
        (output / "storm_gen_outline.txt").write_text(
            "# Physical gels\n## Mechanisms\n## Preparation", encoding="utf-8"
        )


def request() -> ExplorationRequest:
    return ExplorationRequest.model_validate(
        {
            "schemaVersion": "storm-exploration-request-v1",
            "explorationId": "boundary-test",
            "topic": "Physical gels",
            "purpose": "literature_review",
            "language": "en",
            "sourcePolicy": {
                "useWeb": True,
                "useUserDocuments": False,
                "userResourceIds": [],
            },
            "limits": {
                "maxPerspectives": 3,
                "maxQuestionsPerPerspective": 3,
                "maxSearchQueries": 20,
                "maxSources": 20,
                "maximumWallTimeMs": 60_000,
                "maximumModelCalls": 20,
                "maximumInspectionCount": 10,
            },
            "modelProfile": {"provider": "test", "model": "fake"},
        }
    )


def test_runner_never_generates_or_polishes_articles(tmp_path: Path) -> None:
    upstream = RecordingStormRunner()
    result = StormWikiExplorationRunner(upstream).run(request(), tmp_path / "output")
    assert upstream.arguments == {
        "topic": "Physical gels",
        "do_research": True,
        "do_generate_outline": True,
        "do_generate_article": False,
        "do_polish_article": False,
        "remove_duplicate": False,
    }
    assert result.status == "complete"
    assert result.outlines[0].sections[0].heading == "Mechanisms"
