from __future__ import annotations

import json
import os
from pathlib import Path


class StormDependencyUnavailable(RuntimeError):
    pass


_ADMISSION_PATH = Path(__file__).resolve().parents[2] / "runtime-admission.json"


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
    try:
        import knowledge_storm  # noqa: F401
    except ImportError:
        return False
    return True


def create_real_runner() -> object:
    if not runtime_approved():
        raise StormDependencyUnavailable(
            "The real STORM runtime is disabled until its dependency audit is approved."
        )
    if not dependency_available():
        raise StormDependencyUnavailable("knowledge_storm is not installed in this service.")
    raise StormDependencyUnavailable(
        "STORM provider configuration is intentionally deferred to the runtime-integration step."
    )
