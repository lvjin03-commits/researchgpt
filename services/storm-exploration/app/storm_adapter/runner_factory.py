from __future__ import annotations

import os


class StormDependencyUnavailable(RuntimeError):
    pass


def runtime_approved() -> bool:
    return os.getenv("STORM_RUNTIME_APPROVED", "").lower() == "true"


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
