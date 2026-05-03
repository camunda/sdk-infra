#!/usr/bin/env python3
"""
Unified example coverage checker for all Camunda SDKs.

Compares operationIds in the bundled OpenAPI spec against entries in the
SDK's operation-map.json. Exits with code 1 if any operations are missing.

Supports different key styles (camelCase, snake_case, PascalCase) to match
each SDK's convention for operation-map keys.

Usage:
    python3 check-example-coverage.py --spec path/to/rest-api.bundle.json --map path/to/operation-map.json
    python3 check-example-coverage.py --spec spec.json --map map.json --key-style snake_case
    python3 check-example-coverage.py --spec spec.json --map map.json --examples-dir examples
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Key style converters
# ---------------------------------------------------------------------------

def _to_snake_case(name: str) -> str:
    """Convert camelCase/PascalCase operationId to snake_case."""
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return s.lower()


def _to_pascal_case(name: str) -> str:
    """Convert camelCase operationId to PascalCase."""
    return name[0].upper() + name[1:] if name else name


def _identity(name: str) -> str:
    """No conversion (camelCase passthrough)."""
    return name


KEY_CONVERTERS = {
    "camelCase": _identity,
    "snake_case": _to_snake_case,
    "PascalCase": _to_pascal_case,
}


# ---------------------------------------------------------------------------
# Region extraction helpers (for integrity check)
# ---------------------------------------------------------------------------

REGION_START_PATTERNS = [
    re.compile(r"^\s*//\s*#region\s+(.+?)\s*$"),       # TS: //#region
    re.compile(r"^\s*#\s*region\s+(.+?)\s*$"),          # Python: # region
    re.compile(r"^\s*//\s*<([A-Za-z][\w.-]*)>\s*$"),    # C#: // <Region>
    re.compile(r"^\s*//\s*region\s+(.+?)\s*$"),         # Java/Go: // region
]


def extract_regions(content: str) -> set[str]:
    """Extract all region names from a source file."""
    regions: set[str] = set()
    for line in content.splitlines():
        for pattern in REGION_START_PATTERNS:
            m = pattern.match(line)
            if m:
                regions.add(m.group(1).strip())
    return regions


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def check_coverage(
    spec_path: Path,
    map_path: Path,
    examples_dir: Path | None,
    key_converter: callable,
) -> int:
    """Check example coverage. Returns exit code."""

    if not spec_path.exists():
        print(f"Spec not found at {spec_path}", file=sys.stderr)
        print("Run the spec bundler first.", file=sys.stderr)
        return 2

    if not map_path.exists():
        print(f"Operation map not found at {map_path}", file=sys.stderr)
        print("Ensure operation-map.json exists and is committed.", file=sys.stderr)
        return 2

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    operation_map = json.loads(map_path.read_text(encoding="utf-8"))

    HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}

    spec_ops = []
    for path_str, path_item in (spec.get("paths") or {}).items():
        for method, operation in path_item.items():
            if (
                method in HTTP_METHODS
                and isinstance(operation, dict)
                and operation.get("operationId")
            ):
                spec_ops.append(
                    {
                        "operationId": operation["operationId"],
                        "method": method.upper(),
                        "path": path_str,
                        "summary": operation.get("summary", ""),
                    }
                )

    map_keys = set(operation_map.keys())
    covered = [op for op in spec_ops if key_converter(op["operationId"]) in map_keys]
    missing = [op for op in spec_ops if key_converter(op["operationId"]) not in map_keys]

    total = len(spec_ops)
    pct = round(len(covered) / total * 100) if total > 0 else 0

    print(f"Spec operations: {total}")
    print(f"Covered:         {len(covered)}")
    print(f"Missing:         {len(missing)}")
    print(f"Coverage:        {pct}%")

    exit_code = 0

    if missing:
        missing.sort(key=lambda op: op["operationId"])
        print("\nMissing operations:")
        for op in missing:
            key = key_converter(op["operationId"])
            print(f"  - {key} ({op['method']} {op['path']})")

        print("\nTo fix this:")
        print("  1. Add an example for each missing operation in your examples/ directory")
        print("  2. Add an entry to operation-map.json for each operation")

        # Write missing-examples.json for CI consumption
        missing_path = spec_path.parent.parent / "missing-examples.json"
        missing_path.write_text(json.dumps(missing, indent=2), encoding="utf-8")

        exit_code = 1
    else:
        print("\nFull coverage!")
        missing_path = spec_path.parent.parent / "missing-examples.json"
        if missing_path.exists():
            missing_path.unlink()

    # --- Integrity check: every operation-map entry must resolve ---
    if examples_dir and examples_dir.exists():
        integrity_errors: list[str] = []
        file_region_cache: dict[Path, set[str]] = {}

        for op_id, entries in operation_map.items():
            if not isinstance(entries, list):
                integrity_errors.append(f"{op_id}: value is not a list")
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    integrity_errors.append(
                        f"{op_id}: entry is not an object (got {type(entry).__name__})"
                    )
                    continue
                if not isinstance(entry.get("file"), str) or not entry["file"]:
                    integrity_errors.append(f"{op_id}: entry missing 'file' field")
                    continue
                if not isinstance(entry.get("region"), str) or not entry["region"]:
                    integrity_errors.append(f"{op_id}: entry missing 'region' field")
                    continue
                file_path = examples_dir / entry["file"]
                if not file_path.exists():
                    integrity_errors.append(f"{op_id}: file not found: {entry['file']}")
                    continue
                if file_path not in file_region_cache:
                    file_region_cache[file_path] = extract_regions(
                        file_path.read_text(encoding="utf-8")
                    )
                if entry["region"] not in file_region_cache[file_path]:
                    integrity_errors.append(
                        f'{op_id}: region "{entry["region"]}" not found in {entry["file"]}'
                    )

        if integrity_errors:
            print(f"\nIntegrity errors ({len(integrity_errors)}):", file=sys.stderr)
            for err in integrity_errors:
                print(f"  - {err}", file=sys.stderr)
            exit_code = 1

    return exit_code


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check example coverage against the OpenAPI spec."
    )
    parser.add_argument(
        "--spec",
        required=True,
        help="Path to the bundled OpenAPI spec (rest-api.bundle.json).",
    )
    parser.add_argument(
        "--map",
        required=True,
        help="Path to the operation-map.json file.",
    )
    parser.add_argument(
        "--examples-dir",
        default="",
        help="Directory containing example files (for integrity check).",
    )
    parser.add_argument(
        "--key-style",
        choices=sorted(KEY_CONVERTERS.keys()),
        default="camelCase",
        help="Key style in operation-map (default: camelCase).",
    )
    args = parser.parse_args()

    converter = KEY_CONVERTERS[args.key_style]
    examples_dir = Path(args.examples_dir).resolve() if args.examples_dir else None

    exit_code = check_coverage(
        spec_path=Path(args.spec).resolve(),
        map_path=Path(args.map).resolve(),
        examples_dir=examples_dir,
        key_converter=converter,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
