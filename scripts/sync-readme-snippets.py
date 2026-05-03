#!/usr/bin/env python3
"""
Unified README snippet synchronization for all Camunda SDKs.

Replaces code blocks between snippet markers in README.md with the
corresponding region-tagged code from compilable example files.

Supports multiple languages via --lang flag, which selects the
appropriate region tag syntax:

  csharp:     // <RegionName> ... // </RegionName>
  python:     # region RegionName ... # endregion RegionName
  typescript: //#region RegionName ... //#endregion RegionName

Additional languages (java, go) are supported in the parser but not
yet used by any SDK repo.

Usage:
    python3 sync-readme-snippets.py --lang python
    python3 sync-readme-snippets.py --lang csharp --check
    python3 sync-readme-snippets.py --lang typescript --readme ../sdk-js/README.md --examples-dir ../sdk-js/examples

Markers in README.md use the descriptive format:

    <!-- snippet-source: examples/readme.py | regions: RegionName -->

before a fenced code block. Legacy markers (<!-- snippet:RegionName -->)
are auto-migrated to the new format.

Composite regions: regions: A+B+C concatenates multiple regions
separated by blank lines.
"""

from __future__ import annotations

import argparse
import re
import sys
import textwrap
from pathlib import Path


# ---------------------------------------------------------------------------
# Language-specific region tag patterns
# ---------------------------------------------------------------------------

# Region name character class: word chars plus dots and hyphens.
# The JS SDK allows dots and hyphens in region names (e.g. my-region.1).
_RN = r"[\w.-]+"

REGION_PATTERNS: dict[str, dict[str, re.Pattern[str]]] = {
    "csharp": {
        "open": re.compile(rf"^\s*//\s*<({_RN})>\s*$"),
        "close": re.compile(rf"^\s*//\s*</({_RN})>\s*$"),
    },
    "python": {
        "open": re.compile(rf"^\s*#\s*region\s+({_RN})\s*$"),
        "close": re.compile(rf"^\s*#\s*endregion\s+({_RN})\s*$"),
    },
    "typescript": {
        "open": re.compile(rf"^\s*//#region\s+({_RN})\s*$"),
        "close": re.compile(rf"^\s*//#endregion\s+({_RN})\s*$"),
    },
    "java": {
        "open": re.compile(rf"^\s*//\s*region\s+({_RN})\s*$"),
        "close": re.compile(rf"^\s*//\s*endregion\s+({_RN})\s*$"),
    },
    "go": {
        "open": re.compile(rf"^\s*//\s*region\s+({_RN})\s*$"),
        "close": re.compile(rf"^\s*//\s*endregion\s+({_RN})\s*$"),
    },
}

# File extensions to scan for each language.
# NOTE: TypeScript includes *.txt because the JS SDK stores import-only
# snippets in .txt files (e.g. examples/readme-imports.txt) to avoid
# type-checking standalone import statements.
LANG_EXTENSIONS: dict[str, list[str]] = {
    "csharp": ["*.cs"],
    "python": ["*.py"],
    "typescript": ["*.ts", "*.tsx", "*.txt"],
    "java": ["*.java"],
    "go": ["*.go"],
}

# Language names for fenced code block detection
LANG_FENCE_NAMES: dict[str, set[str]] = {
    "csharp": {"csharp", "c#", "cs"},
    "python": {"python", "py"},
    "typescript": {"typescript", "ts", "javascript", "js"},
    "java": {"java"},
    "go": {"go", "golang"},
}


# ---------------------------------------------------------------------------
# Region extraction
# ---------------------------------------------------------------------------

def parse_region_tags(
    file_path: Path,
    patterns: dict[str, re.Pattern[str]],
) -> dict[str, str]:
    """Extract region-tagged code blocks from a source file."""
    text = file_path.read_text(encoding="utf-8")
    regions: dict[str, str] = {}
    current_tag: str | None = None
    lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        m_open = patterns["open"].match(stripped)
        m_close = patterns["close"].match(stripped)

        if m_open:
            current_tag = m_open.group(1)
            lines = []
        elif m_close and current_tag == m_close.group(1):
            regions[current_tag] = textwrap.dedent("\n".join(lines))
            current_tag = None
            lines = []
        elif current_tag is not None:
            lines.append(line)

    return regions


def load_all_regions(
    examples_dir: Path,
    repo_root: Path,
    lang: str,
) -> tuple[dict[str, str], dict[str, str]]:
    """Load regions from all example files.

    Returns (region_content, region_source) where region_source maps
    region name -> relative source file path.
    """
    patterns = REGION_PATTERNS[lang]
    extensions = LANG_EXTENSIONS[lang]
    all_regions: dict[str, str] = {}
    region_source: dict[str, str] = {}

    for ext in extensions:
        for source_file in sorted(examples_dir.rglob(ext)):
            rel = source_file.relative_to(repo_root).as_posix()
            for name, content in parse_region_tags(source_file, patterns).items():
                if name in all_regions:
                    print(
                        f'WARNING: duplicate region "{name}" defined in both '
                        f"{region_source[name]} and {rel} (using {rel})",
                        file=sys.stderr,
                    )
                all_regions[name] = content
                region_source[name] = rel

    return all_regions, region_source


# ---------------------------------------------------------------------------
# README rewriting
# ---------------------------------------------------------------------------

# New descriptive format:
#   <!-- snippet-source: examples/readme.py | regions: RegionName -->
# The source path may contain commas for multi-source markers (JS SDK uses
# comma-separated paths like "examples/readme-imports.txt,examples/readme.ts").
# Region names may contain word chars, dots, hyphens, and '+' for composites.
_NEW_MARKER = re.compile(
    r"^<!--\s*snippet-source:\s*\S+\s*\|\s*regions:\s*([\w.+-]+)\s*-->$"
)
# Legacy format (for migration):
#   <!-- snippet:RegionName -->
_OLD_MARKER = re.compile(r"^<!--\s*snippet:([\w.+-]+)\s*-->$")
# Exempt marker: <!-- snippet-exempt: reason -->
_EXEMPT_MARKER = re.compile(r"^<!--\s*snippet-exempt:.*-->$")


def _match_marker(line: str) -> re.Match[str] | None:
    """Match either new or legacy snippet marker."""
    return _NEW_MARKER.match(line) or _OLD_MARKER.match(line)


def _build_marker(region_name: str, region_source: dict[str, str]) -> str:
    """Build a descriptive snippet marker line for region_name.

    When a composite region (A+B) spans multiple source files, the source
    path uses comma-separated values (e.g. 'examples/a.txt,examples/b.ts')
    matching the JS SDK's convention.
    """
    parts = region_name.split("+") if "+" in region_name else [region_name]
    sources = []
    seen: set[str] = set()
    for p in parts:
        src = region_source.get(p)
        if src and src not in seen:
            sources.append(src)
            seen.add(src)
    if not sources:
        source_file = "examples/?.src"
    elif len(sources) == 1:
        source_file = sources[0]
    else:
        source_file = ",".join(sources)
    return f"<!-- snippet-source: {source_file} | regions: {region_name} -->"


def resolve_region(name: str, regions: dict[str, str]) -> str | None:
    """Resolve a region name, supporting A+B composite syntax."""
    if "+" not in name:
        return regions.get(name)
    parts = name.split("+")
    resolved = [regions.get(p) for p in parts]
    if any(r is None for r in resolved):
        return None
    return "\n\n".join(r for r in resolved if r)


def sync_readme(
    readme_path: Path,
    regions: dict[str, str],
    region_source: dict[str, str],
    *,
    check: bool = False,
) -> bool:
    """Replace snippet-marked code blocks in README.md.

    Also upgrades legacy <!-- snippet:X --> markers to the new
    <!-- snippet-source: file | regions: X --> format.

    Returns True if the file was (or would be) changed.
    """
    readme_text = readme_path.read_text(encoding="utf-8")
    lines = readme_text.splitlines(keepends=True)

    out: list[str] = []
    i = 0
    changed = False
    missing: list[str] = []
    errors: list[str] = []
    snippet_count = 0

    while i < len(lines):
        line = lines[i].rstrip("\n")
        m = _match_marker(line.strip())

        if not m:
            out.append(lines[i])
            i += 1
            continue

        region_name = m.group(1)
        content = resolve_region(region_name, regions)

        if content is None:
            missing.append(region_name)
            out.append(lines[i])
            i += 1
            continue

        snippet_count += 1

        # Upgrade legacy marker to the new descriptive format
        new_marker = _build_marker(region_name, region_source) + "\n"
        if lines[i] != new_marker:
            changed = True
        out.append(new_marker)
        i += 1

        # Skip whitespace between marker and opening fence
        while i < len(lines) and lines[i].strip() == "":
            out.append(lines[i])
            i += 1

        # Expect opening fence
        if i >= len(lines) or not lines[i].strip().startswith("```"):
            errors.append(f"snippet:{region_name} — expected ``` after marker")
            continue

        fence_lang = lines[i].strip()  # e.g. ```python

        # Find closing fence
        close_idx = i + 1
        while close_idx < len(lines) and lines[close_idx].strip() != "```":
            close_idx += 1

        if close_idx >= len(lines):
            errors.append(f"snippet:{region_name} — no closing ``` found")
            out.append(lines[i])
            i += 1
            continue

        # Build replacement block
        new_block = fence_lang + "\n" + content + "\n```\n"
        old_block = "".join(lines[i : close_idx + 1])

        if old_block != new_block:
            changed = True

        out.append(new_block)
        i = close_idx + 1

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)

    if missing:
        print(f"ERROR: missing regions: {', '.join(missing)}", file=sys.stderr)

    if errors or missing:
        sys.exit(1)

    new_text = "".join(out)

    if check:
        if changed:
            print("README.md is out of sync with example snippets. Run:")
            print("  python3 scripts/sync-readme-snippets.py --lang <lang>")
        return changed

    if changed:
        readme_path.write_text(new_text, encoding="utf-8", newline="")
        print(f"README.md updated ({snippet_count} snippets synced)")
    else:
        print("README.md is already up to date")

    return changed


# ---------------------------------------------------------------------------
# Un-injected code block detection
# ---------------------------------------------------------------------------

def detect_uninjected_code_blocks(
    readme_path: Path,
    checked_languages: set[str],
) -> list[tuple[int, str]]:
    """Find fenced code blocks that use a checked language but are NOT
    preceded by a snippet marker or exempt marker.

    Returns a list of (line_number, fence_line) tuples (1-based).
    """
    text = readme_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    uninjected: list[tuple[int, str]] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("```"):
            continue
        lang = stripped.removeprefix("```").strip().lower()
        if lang not in checked_languages:
            continue
        # Look backward for a snippet marker or exempt marker (skip blank lines)
        prev = idx - 1
        while prev >= 0 and lines[prev].strip() == "":
            prev -= 1
        if prev >= 0:
            prev_stripped = lines[prev].strip()
            if _match_marker(prev_stripped) or _EXEMPT_MARKER.match(prev_stripped):
                continue
        uninjected.append((idx + 1, stripped))

    return uninjected


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync README code snippets from example files."
    )
    parser.add_argument(
        "--lang",
        required=True,
        choices=sorted(REGION_PATTERNS.keys()),
        help="Language for region tag detection.",
    )
    parser.add_argument(
        "--readme",
        default="README.md",
        help="Path to README.md (default: README.md in current directory).",
    )
    parser.add_argument(
        "--examples-dir",
        default="",
        help="Directory containing example source files. "
        "Defaults to 'examples' (or 'docs/examples' for csharp).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check mode: exit 1 if README is out of sync.",
    )
    args = parser.parse_args()

    readme_path = Path(args.readme).resolve()
    repo_root = readme_path.parent

    if args.examples_dir:
        examples_dir = Path(args.examples_dir).resolve()
    elif args.lang == "csharp":
        examples_dir = repo_root / "docs" / "examples"
    else:
        examples_dir = repo_root / "examples"

    if not readme_path.exists():
        print(f"ERROR: README not found: {readme_path}", file=sys.stderr)
        sys.exit(1)

    if not examples_dir.exists():
        print(f"ERROR: Examples directory not found: {examples_dir}", file=sys.stderr)
        sys.exit(1)

    regions, region_source = load_all_regions(examples_dir, repo_root, args.lang)
    print(f"Loaded {len(regions)} regions from {examples_dir}")

    changed = sync_readme(readme_path, regions, region_source, check=args.check)

    # Detect un-injected code blocks
    checked_languages = LANG_FENCE_NAMES.get(args.lang, set())
    uninjected = detect_uninjected_code_blocks(readme_path, checked_languages)
    if uninjected:
        print(
            f"\nWARNING: {len(uninjected)} {args.lang} code block(s) in README.md are NOT "
            "snippet-injected (not type-checked):",
            file=sys.stderr,
        )
        for lineno, fence in uninjected:
            print(f"  line {lineno}: {fence}", file=sys.stderr)
        if args.check:
            print(
                f"\nAll {args.lang} code blocks must be injected from compilable examples. "
                "Add a snippet marker above each block, or use "
                "<!-- snippet-exempt: reason --> to opt out.",
                file=sys.stderr,
            )
            sys.exit(1)

    if args.check and changed:
        sys.exit(1)


if __name__ == "__main__":
    main()
