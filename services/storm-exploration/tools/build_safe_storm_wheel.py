from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path


UPSTREAM_VERSION = "1.1.1"
LOCAL_VERSION = "1.1.1+researchgpt.4"
UPSTREAM_WHEEL_SHA256 = (
    "85e9ca115463bfe0731620d7b95b630b7509ba3b665e6e02d90b7fb7baef13d2"
)
UPSTREAM_DIST_INFO = "knowledge_storm-1.1.1.dist-info"
LOCAL_DIST_INFO = "knowledge_storm-1.1.1+researchgpt.4.dist-info"
OUTPUT_NAME = "knowledge_storm-1.1.1+researchgpt.4-py3-none-any.whl"
FIXED_TIMESTAMP = (2025, 9, 29, 22, 34, 32)


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"Expected one {label} patch target, found {count}.")
    return source.replace(old, new, 1)


def _patch_lm(source: str) -> str:
    source = _replace_once(
        source,
        "from transformers import AutoTokenizer\n",
        "",
        "eager Hugging Face tokenizer import",
    )
    source = _replace_once(
        source,
        "            logging.info(\"Loading huggingface tokenizer.\")\n"
        "            if hf_tokenizer_name is None:",
        "            logging.info(\"Loading huggingface tokenizer.\")\n"
        "            try:\n"
        "                from transformers import AutoTokenizer\n"
        "            except ImportError as error:\n"
        "                raise RuntimeError(\n"
        "                    'Hugging Face tokenization is not installed in the '\n"
        "                    'ResearchGPT STORM research runtime.'\n"
        "                ) from error\n"
        "            if hf_tokenizer_name is None:",
        "lazy Hugging Face tokenizer import",
    )
    source = _replace_once(
        source,
        'from litellm.caching.caching import Cache\n\ndisk_cache_dir = os.path.join(Path.home(), ".storm_local_cache")\nlitellm.cache = Cache(disk_cache_dir=disk_cache_dir, type="disk")',
        "# ResearchGPT safety fork: persistent LiteLLM caching is disabled.\nlitellm.cache = None",
        "lm disk cache",
    )
    source = _replace_once(source, "        cache=True,", "        cache=False,", "LM default cache")
    source = source.replace(
        'cache={"no-cache": False, "no-store": False}',
        'cache={"no-cache": True, "no-store": True}',
    )
    if 'type="disk"' in source or "cache=True" in source:
        raise ValueError("lm.py still enables persistent caching after patching.")
    return source


def _patch_encoder(source: str) -> str:
    source = _replace_once(
        source,
        '    from litellm.caching.caching import Cache\n\n    disk_cache_dir = os.path.join(Path.home(), ".storm_local_cache")\n    litellm.cache = Cache(disk_cache_dir=disk_cache_dir, type="disk")',
        "    # ResearchGPT safety fork: persistent LiteLLM caching is disabled.\n    litellm.cache = None",
        "encoder disk cache",
    )
    if 'type="disk"' in source:
        raise ValueError("encoder.py still enables persistent caching after patching.")
    return source


def _patch_storm_dataclass(source: str) -> str:
    source = _replace_once(
        source,
        "from sentence_transformers import SentenceTransformer\n"
        "from sklearn.metrics.pairwise import cosine_similarity\n",
        "",
        "eager local embedding imports",
    )
    source = _replace_once(
        source,
        "    def prepare_table_for_retrieval(self):\n"
        '        self.encoder = SentenceTransformer("paraphrase-MiniLM-L6-v2")',
        "    def prepare_table_for_retrieval(self):\n"
        "        # Optional article-generation capability; excluded from the\n"
        "        # ResearchGPT research-and-outline runtime.\n"
        "        try:\n"
        "            from sentence_transformers import SentenceTransformer\n"
        "            from sklearn.metrics.pairwise import cosine_similarity\n"
        "        except ImportError as error:\n"
        "            raise RuntimeError(\n"
        "                'Local semantic retrieval is not installed in the '\n"
        "                'ResearchGPT STORM research runtime.'\n"
        "            ) from error\n"
        "        self._cosine_similarity = cosine_similarity\n"
        '        self.encoder = SentenceTransformer("paraphrase-MiniLM-L6-v2")',
        "lazy local embedding imports",
    )
    source = _replace_once(
        source,
        "            sim = cosine_similarity([encoded_query], self.encoded_snippets)[0]",
        "            sim = self._cosine_similarity([encoded_query], self.encoded_snippets)[0]",
        "lazy cosine similarity use",
    )
    return source


def _patch_package_init(source: str) -> str:
    return _replace_once(
        source,
        "from .collaborative_storm import *\n",
        "# Co-STORM is outside the approved ResearchGPT research runtime.\n",
        "Co-STORM eager import",
    )


def _patch_metadata(source: str) -> str:
    source = _replace_once(
        source,
        f"Version: {UPSTREAM_VERSION}",
        f"Version: {LOCAL_VERSION}",
        "metadata version",
    )
    for dependency in (
        "diskcache",
        "sentence-transformers",
        "langchain-huggingface",
        "qdrant-client",
        "langchain-qdrant",
    ):
        source = _replace_once(
            source,
            f"Requires-Dist: {dependency}\n",
            "",
            f"{dependency} dependency",
        )
    return source


def _record_digest(content: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).decode("ascii")
    return digest.rstrip("=")


def build_safe_wheel(input_wheel: Path, output_dir: Path) -> Path:
    upstream_hash = hashlib.sha256(input_wheel.read_bytes()).hexdigest()
    if upstream_hash != UPSTREAM_WHEEL_SHA256:
        raise ValueError(
            f"Unexpected upstream wheel SHA-256: {upstream_hash}; "
            f"expected {UPSTREAM_WHEEL_SHA256}."
        )

    entries: dict[str, bytes] = {}
    with zipfile.ZipFile(input_wheel, "r") as archive:
        for entry in archive.infolist():
            if entry.is_dir() or entry.filename.endswith("/RECORD"):
                continue
            name = entry.filename.replace(UPSTREAM_DIST_INFO, LOCAL_DIST_INFO, 1)
            content = archive.read(entry.filename)
            if entry.filename == "knowledge_storm/lm.py":
                source = content.decode("utf-8").replace("\r\n", "\n")
                content = _patch_lm(source).encode("utf-8")
            elif entry.filename == "knowledge_storm/__init__.py":
                source = content.decode("utf-8").replace("\r\n", "\n")
                content = _patch_package_init(source).encode("utf-8")
            elif entry.filename == "knowledge_storm/encoder.py":
                source = content.decode("utf-8").replace("\r\n", "\n")
                content = _patch_encoder(source).encode("utf-8")
            elif entry.filename == "knowledge_storm/storm_wiki/modules/storm_dataclass.py":
                source = content.decode("utf-8").replace("\r\n", "\n")
                content = _patch_storm_dataclass(source).encode("utf-8")
            elif entry.filename == f"{UPSTREAM_DIST_INFO}/METADATA":
                source = content.decode("utf-8").replace("\r\n", "\n")
                content = _patch_metadata(source).encode("utf-8")
            entries[name] = content

    provenance = {
        "schemaVersion": "researchgpt-storm-wheel-provenance-v1",
        "upstreamPackage": "knowledge-storm",
        "upstreamVersion": UPSTREAM_VERSION,
        "upstreamWheelSha256": UPSTREAM_WHEEL_SHA256,
        "localVersion": LOCAL_VERSION,
        "changes": [
            "remove mandatory diskcache dependency",
            "disable LiteLLM persistent disk cache initialization",
            "default model calls to cache disabled",
            "retain process-local functools LRU only",
            "make local sentence-transformer retrieval an optional capability",
            "remove local vector-store dependencies from the research-and-outline runtime",
            "make local Hugging Face tokenization an optional capability",
            "remove Co-STORM eager loading from the scoped research runtime",
        ],
    }
    entries[f"{LOCAL_DIST_INFO}/researchgpt-provenance.json"] = (
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")

    record_name = f"{LOCAL_DIST_INFO}/RECORD"
    record_buffer = io.StringIO(newline="")
    writer = csv.writer(record_buffer, lineterminator="\n")
    for name in sorted(entries):
        content = entries[name]
        writer.writerow([name, f"sha256={_record_digest(content)}", len(content)])
    writer.writerow([record_name, "", ""])
    entries[record_name] = record_buffer.getvalue().encode("utf-8")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_wheel = output_dir / OUTPUT_NAME
    # Wheel bytes are part of the admitted runtime contract. Deflate output can
    # vary across zlib versions even when every uncompressed entry is identical,
    # which produced different hashes on Windows and Linux. The scoped wheel is
    # small, so store entries verbatim to make the artifact cross-platform
    # reproducible and keep strict hash installation meaningful.
    with zipfile.ZipFile(output_wheel, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            archive.writestr(info, entries[name], compress_type=zipfile.ZIP_STORED)
    return output_wheel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_wheel", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = build_safe_wheel(args.input_wheel, args.output_dir)
    print(output)
    print(hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
