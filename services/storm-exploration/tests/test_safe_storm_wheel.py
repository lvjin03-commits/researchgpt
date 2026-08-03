from __future__ import annotations

import base64
import csv
import hashlib
import io
import zipfile
from pathlib import Path

import pytest

from tools.build_safe_storm_wheel import (
    LOCAL_DIST_INFO,
    OUTPUT_NAME,
    UPSTREAM_DIST_INFO,
    UPSTREAM_WHEEL_SHA256,
    build_safe_wheel,
)


def _verify_record(archive: zipfile.ZipFile) -> None:
    rows = csv.reader(
        io.StringIO(archive.read(f"{LOCAL_DIST_INFO}/RECORD").decode("utf-8"))
    )
    for name, digest, size in rows:
        if not digest:
            assert name == f"{LOCAL_DIST_INFO}/RECORD"
            continue
        content = archive.read(name)
        actual = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).decode()
        assert digest == f"sha256={actual.rstrip('=')}"
        assert int(size) == len(content)


def test_builds_safe_reproducible_wheel(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    upstream = tmp_path / "knowledge_storm-1.1.1-py3-none-any.whl"
    with zipfile.ZipFile(upstream, "w") as archive:
        archive.writestr(
            "knowledge_storm/__init__.py",
            "from .storm_wiki import *\nfrom .collaborative_storm import *\n",
        )
        archive.writestr(
            "knowledge_storm/lm.py",
            "from transformers import AutoTokenizer\n"
            'from litellm.caching.caching import Cache\n\n'
            'disk_cache_dir = os.path.join(Path.home(), ".storm_local_cache")\n'
            'litellm.cache = Cache(disk_cache_dir=disk_cache_dir, type="disk")\n'
            "\nclass LM:\n"
            "    def __init__(\n"
            "        self,\n"
            "        cache=True,\n"
            "    ):\n"
            "        pass\n"
            "\nclass HF:\n"
            "    def __init__(self, hf_tokenizer_name=None):\n"
            "        if True:\n"
            '            logging.info("Loading huggingface tokenizer.")\n'
            "            if hf_tokenizer_name is None:\n"
            "                hf_tokenizer_name = 'example'\n"
            "            self.tokenizer = AutoTokenizer.from_pretrained(hf_tokenizer_name)\n"
            "\ndef cached_litellm_completion(request):\n"
            '    return litellm_completion(request, cache={"no-cache": False, "no-store": False})\n',
        )
        archive.writestr(
            "knowledge_storm/encoder.py",
            "try:\n"
            "    from litellm.caching.caching import Cache\n\n"
            '    disk_cache_dir = os.path.join(Path.home(), ".storm_local_cache")\n'
            '    litellm.cache = Cache(disk_cache_dir=disk_cache_dir, type="disk")\n'
            "except ImportError:\n"
            "    pass\n",
        )
        archive.writestr(
            f"{UPSTREAM_DIST_INFO}/METADATA",
            "Name: knowledge-storm\n"
            "Version: 1.1.1\n"
            "Requires-Dist: diskcache\n"
            "Requires-Dist: sentence-transformers\n"
            "Requires-Dist: langchain-huggingface\n"
            "Requires-Dist: qdrant-client\n"
            "Requires-Dist: langchain-qdrant\n",
        )
        archive.writestr(
            "knowledge_storm/storm_wiki/modules/storm_dataclass.py",
            "from sentence_transformers import SentenceTransformer\n"
            "from sklearn.metrics.pairwise import cosine_similarity\n\n"
            "class Table:\n"
            "    def prepare_table_for_retrieval(self):\n"
            '        self.encoder = SentenceTransformer("paraphrase-MiniLM-L6-v2")\n'
            "\n"
            "    def retrieve_information(self):\n"
            "        for encoded_query in []:\n"
            "            sim = cosine_similarity([encoded_query], self.encoded_snippets)[0]\n",
        )
        archive.writestr(f"{UPSTREAM_DIST_INFO}/licenses/LICENSE", "MIT\n")
        archive.writestr(f"{UPSTREAM_DIST_INFO}/RECORD", "")

    fake_hash = hashlib.sha256(upstream.read_bytes()).hexdigest()
    monkeypatch.setattr(
        "tools.build_safe_storm_wheel.UPSTREAM_WHEEL_SHA256", fake_hash
    )
    first = build_safe_wheel(upstream, tmp_path / "first")
    second = build_safe_wheel(upstream, tmp_path / "second")

    assert first.name == OUTPUT_NAME
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        assert all(
            entry.compress_type == zipfile.ZIP_STORED
            for entry in archive.infolist()
        )
        metadata = archive.read(f"{LOCAL_DIST_INFO}/METADATA").decode("utf-8")
        lm_source = archive.read("knowledge_storm/lm.py").decode("utf-8")
        encoder_source = archive.read("knowledge_storm/encoder.py").decode("utf-8")
        assert "Version: 1.1.1+researchgpt.4" in metadata
        assert "Requires-Dist: diskcache" not in metadata
        assert "Requires-Dist: sentence-transformers" not in metadata
        assert "Requires-Dist: langchain-huggingface" not in metadata
        assert "Requires-Dist: qdrant-client" not in metadata
        assert "Requires-Dist: langchain-qdrant" not in metadata
        assert 'type="disk"' not in lm_source
        assert "cache=True" not in lm_source
        assert lm_source.index("try:", lm_source.index("class HF")) < lm_source.index(
            "from transformers import AutoTokenizer"
        )
        assert 'type="disk"' not in encoder_source
        dataclass_source = archive.read(
            "knowledge_storm/storm_wiki/modules/storm_dataclass.py"
        ).decode("utf-8")
        assert "from sentence_transformers import SentenceTransformer" in dataclass_source
        assert dataclass_source.index("try:") < dataclass_source.index(
            "from sentence_transformers import SentenceTransformer"
        )
        assert "self._cosine_similarity" in dataclass_source
        package_init = archive.read("knowledge_storm/__init__.py").decode("utf-8")
        assert "from .storm_wiki import *" in package_init
        assert "from .collaborative_storm import *" not in package_init
        assert f"{LOCAL_DIST_INFO}/licenses/LICENSE" in archive.namelist()
        _verify_record(archive)


def test_rejects_unexpected_upstream_hash(tmp_path: Path) -> None:
    upstream = tmp_path / "unexpected.whl"
    upstream.write_bytes(b"not the approved wheel")
    with pytest.raises(ValueError, match=UPSTREAM_WHEEL_SHA256):
        build_safe_wheel(upstream, tmp_path / "output")
