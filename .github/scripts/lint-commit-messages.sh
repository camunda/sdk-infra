#!/usr/bin/env bash
# Lints the commit messages in <from>..<to> the way the PR's commitlint check
# will, so the agent workflows can catch a bad message while the commits are
# still unpublished and can be reworded. Once pushed, a follow-up run can only
# add commits, so a bad message on the branch needs a human to fix it.
#
# Mirrors .github/workflows/sdk-commitlint.yml: the repo's own commitlint and
# config when package.json declares commitlint, otherwise a standalone install.
# Matching it matters — commitlint 19 and 21 parse the same message into
# different footers, so a newer linter can pass what the PR check rejects.
#
# Runs in a throwaway worktree of <to>, so installing commitlint never leaves
# node_modules or a lockfile in the caller's working tree.
#
# Usage: lint-commit-messages.sh <from> <to>   (run from the SDK repo root)
set -euo pipefail

from="${1:?usage: lint-commit-messages.sh <from> <to>}"
to="${2:?usage: lint-commit-messages.sh <from> <to>}"
status=0

# `git commit -m "subject\n\nbody"` stores a literal backslash-n, joining the
# whole body onto one line. commitlint only sometimes notices (when the joined
# line is long enough), and a `Closes #N` inside it never links the issue.
# Matched on what that leaves behind — an escaped paragraph break, or an escape
# right before a trailer or issue reference — so prose that merely mentions
# `\n` passes.
literal=""
for sha in $(git rev-list "${from}..${to}"); do
  if git log -1 --format=%B "$sha" \
    | grep -Eq '\\n\\n[A-Za-z]|\\n([A-Za-z][A-Za-z-]*: |(Closes|Fixes|Resolves|Refs) #)'; then
    literal+="$(git log -1 --format='%h %s' "$sha")"$'\n'
  fi
done
if [ -n "$literal" ]; then
  printf '%s\n' "::error::Commit messages contain a literal '\\n' instead of a line break:"
  printf '%s' "$literal" | sed 's/^/  /'
  echo "Write multi-line messages with 'git commit -F <file>' or one '-m' per paragraph."
  status=1
fi

worktree="$(mktemp -d)"
# shellcheck disable=SC2329  # invoked by the EXIT trap
cleanup() { git worktree remove --force "$worktree" >/dev/null 2>&1 || rm -rf "$worktree"; }
trap cleanup EXIT
git worktree add --detach --quiet "$worktree" "$to"

# The `|| status=1` on this subshell disables `set -e` inside it, so each step
# that must stop the run says so explicitly. Otherwise a failed install (a
# lifecycle script, say) is ignored whenever commitlint still happens to run,
# where sdk-commitlint.yml would have stopped at the install.
(
  cd "$worktree" || exit 1
  if [ -f package.json ] && grep -q commitlint package.json; then
    npm ci --no-audit --no-fund --loglevel=error >/dev/null || exit 1
  else
    npm install --no-save --no-audit --no-fund --loglevel=error \
      @commitlint/cli @commitlint/config-conventional >/dev/null || exit 1
  fi
  npx --no-install commitlint --from "$from" --to "$to" --verbose
) || status=1

exit "$status"
