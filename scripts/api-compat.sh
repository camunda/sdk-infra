#!/usr/bin/env bash
# Public-API compatibility policy shared by the Camunda SDKs.
#
# The language tool only answers "does <new-dir> break <old-dir>?". This script owns
# everything around it: which baseline to compare with, when there is nothing to
# protect, the api-break-approved override, annotations and the step summary.
# Used by .github/workflows/sdk-api-compat.yml; runnable locally too.
#
# Environment:
#   API_COMPAT_MODE        pr | release (default pr)
#   API_COMPAT_MAJOR       Major to protect, e.g. 8 (pr mode: derived from stable/<N>)
#   API_COMPAT_COMPARE     Command run as: $API_COMPAT_COMPARE <old-dir> <new-dir>
#                          exit 0 = no breaks, 1 = breaks, anything else = tool error
#   API_COMPAT_NEW_DIR     Tree under test (default .)
#   API_COMPAT_OLD_DIR     pr mode: checkout of the base branch (required)
#   API_COMPAT_TAG_PATTERN Glob for published releases of a major; {major} is replaced
#                          (default v{major}.*). Prerelease tags (a "-" after a version digit, e.g. v8.1.0-alpha.1) are ignored.
#   API_COMPAT_REPO        Git repo whose tags are searched (default API_COMPAT_NEW_DIR)
#   API_COMPAT_APPROVED    "true" when the api-break-approved label is applied
#
# Exit: 0 pass, 1 unapproved break, 2 tool or setup error.
set -uo pipefail

mode="${API_COMPAT_MODE:-pr}"
major="${API_COMPAT_MAJOR:-}"
compare="${API_COMPAT_COMPARE:-}"
new_dir="${API_COMPAT_NEW_DIR:-.}"
old_dir="${API_COMPAT_OLD_DIR:-}"
pattern="${API_COMPAT_TAG_PATTERN:-}"
[ -n "$pattern" ] || pattern='v{major}.*'
repo="${API_COMPAT_REPO:-$new_dir}"
approved="${API_COMPAT_APPROVED:-false}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

die() { echo "::error::$*"; exit 2; }

[ -n "$compare" ] || die "API_COMPAT_COMPARE is not set."
[[ "$major" =~ ^[0-9]+$ ]] || die "Cannot determine the major version to protect (got '${major}')."
case "$mode" in pr|release) ;; *) die "Unknown mode '${mode}' (expected pr or release)." ;; esac

glob="${pattern//\{major\}/$major}"
tags=$(git -C "$repo" tag -l "$glob" --sort=-v:refname) || die "Cannot list tags in ${repo}."
baseline=$(printf '%s\n' "$tags" | grep -Ev -e '[0-9]-' -e '^$' | head -n1 || true)
if [ -z "$baseline" ]; then
  echo "::notice::No ${major}.x release published yet; nothing to protect."
  echo "No ${major}.x release published yet; nothing to protect." >> "$summary"
  exit 0
fi

if [ "$mode" = release ]; then
  old_dir="${tmp}/api-compat-baseline"
  rm -rf "$old_dir"
  git -C "$repo" worktree add --detach "$old_dir" "$baseline" >/dev/null 2>&1 \
    || die "Cannot check out baseline ${baseline}."
  # shellcheck disable=SC2064
  trap "git -C '$repo' worktree remove --force '$old_dir' >/dev/null 2>&1" EXIT
  against="last release ${baseline}"
else
  [ -n "$old_dir" ] && [ -d "$old_dir" ] || die "API_COMPAT_OLD_DIR (base branch checkout) is missing."
  against="base branch"
fi

out="${tmp}/api-compat.txt"
rc=0
# Intentionally word-split: the compare command may carry arguments.
# shellcheck disable=SC2086
$compare "$old_dir" "$new_dir" > "$out" 2>&1 || rc=$?
cat "$out"
{
  echo "## API compatibility (against ${against})"
  echo '```'
  cat "$out"
  echo '```'
} >> "$summary" || exit 2

case "$rc" in
  0) exit 0 ;;
  1)
    if [ "$approved" = true ]; then
      echo "::warning::Breaking API changes approved with the api-break-approved label."
      echo "Approved with the \`api-break-approved\` label." >> "$summary"
      exit 0
    fi
    echo "::error::Breaking public API changes against ${against}. If this break is intended (e.g. a bug fix that must change the API), apply the api-break-approved label. Otherwise make the change backward compatible."
    exit 1 ;;
  *) die "API compatibility tool failed (exit ${rc})." ;;
esac
