from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path


def license_value(distribution: importlib.metadata.Distribution) -> str:
    expression = distribution.metadata.get("License-Expression")
    if expression and expression.strip():
        return expression.strip()
    legacy = distribution.metadata.get("License")
    if legacy and legacy.strip():
        return legacy.strip()
    classifiers = [
        value.split(" :: ")[-1]
        for value in distribution.metadata.get_all("Classifier") or []
        if value.startswith("License ::")
    ]
    return "; ".join(classifiers) or "UNKNOWN"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    packages = []
    for distribution in importlib.metadata.distributions():
        packages.append(
            {
                "name": distribution.metadata.get("Name", ""),
                "version": distribution.version,
                "license": license_value(distribution),
                "homepage": distribution.metadata.get("Home-page")
                or distribution.metadata.get("Project-URL"),
            }
        )
    packages.sort(key=lambda package: package["name"].lower())
    payload = {
        "schemaVersion": "storm-runtime-license-inventory-v1",
        "packageCount": len(packages),
        "unknownLicenseCount": sum(
            package["license"] == "UNKNOWN" for package in packages
        ),
        "packages": packages,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
