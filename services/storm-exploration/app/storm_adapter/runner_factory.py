from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


class StormDependencyUnavailable(RuntimeError):
    pass


_ADMISSION_PATH = Path(__file__).resolve().parents[2] / "runtime-admission.json"


def prepare_upstream_runtime_environment() -> None:
    """Disable upstream caches before importing DSPy or knowledge_storm."""
    disabled_cache_root = Path(tempfile.gettempdir()) / "researchgpt-storm-disabled-cache"
    os.environ["DSP_CACHEBOOL"] = "false"
    os.environ["DSP_CACHEDIR"] = str(disabled_cache_root / "dspy")
    os.environ.pop("DSP_NOTEBOOK_CACHEDIR", None)


def admission_status() -> str:
    try:
        payload = json.loads(_ADMISSION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "missing"
    if payload.get("schemaVersion") != "storm-runtime-admission-v1":
        return "invalid"
    return str(payload.get("status", "invalid"))


def admission_approved() -> bool:
    try:
        payload = json.loads(_ADMISSION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        payload.get("schemaVersion") == "storm-runtime-admission-v1"
        and payload.get("status") == "approved"
        and payload.get("approved") is True
        and isinstance(payload.get("lockFile"), str)
        and bool(payload["lockFile"].strip())
    )


def runtime_approved() -> bool:
    return (
        os.getenv("STORM_RUNTIME_APPROVED", "").lower() == "true"
        and admission_approved()
    )


def dependency_available() -> bool:
    prepare_upstream_runtime_environment()
    try:
        import knowledge_storm  # noqa: F401
    except ImportError:
        return False
    return True


def provider_configuration_available() -> bool:
    from app.storm_adapter.provider_runner import (
        StormProviderConfig,
        StormProviderConfigurationError,
    )

    try:
        StormProviderConfig.from_environment()
    except StormProviderConfigurationError:
        return False
    return True


def create_real_runner() -> object:
    if not runtime_approved():
        raise StormDependencyUnavailable(
            "The real STORM runtime is disabled until its dependency audit is approved."
        )
    if not dependency_available():
        raise StormDependencyUnavailable("knowledge_storm is not installed in this service.")
    from app.storm_adapter.provider_runner import (
        ProviderBackedStormExplorationRunner,
        StormProviderConfig,
    )

    return ProviderBackedStormExplorationRunner(StormProviderConfig.from_environment())
