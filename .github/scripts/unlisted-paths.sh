#!/usr/bin/env bash
# Reads repository paths on stdin and prints those matching none of the
# newline-separated globs in the file given as $1.
#
# Shared by the agent workflows so that the working-tree check before
# verification and the allow-list check after it agree on what a
# `verify-artifacts` glob matches.
set -euo pipefail

patterns_file="${1:?usage: unlisted-paths.sh <patterns-file>}"

while IFS= read -r path; do
  [ -n "$path" ] || continue
  matched=false
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    # shellcheck disable=SC2254  # the pattern is an intentional glob
    case "$path" in $pattern) matched=true; break ;; esac
  done <"$patterns_file"
  [ "$matched" = true ] || printf '%s\n' "$path"
done
