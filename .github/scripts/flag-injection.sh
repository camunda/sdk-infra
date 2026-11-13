#!/usr/bin/env bash
# Names the kinds of instruction-like content found in untrusted text, one category per
# line, from a fixed list and in a fixed order. Reads the file given as $1, or stdin.
#
# The agent workflows put attacker-influenced text (issue bodies, comments, bot reviews,
# CI logs) in front of `copilot --yolo`. This is a deterministic tripwire over that text:
# a caller that gets any output tells the agent, in the trusted part of the prompt, to
# treat the untrusted block with extra suspicion (camunda/sdk-infra#84).
#
# It is a mitigation and nothing more. The patterns are easy to evade by rephrasing, and
# they do not replace the nonce framing of the untrusted block or the job split that keeps
# credentials away from the agent. Accordingly:
#   - it only ever prints a category name, never the text it matched, so nothing
#     attacker-controlled is moved out of the framed block by it;
#   - it never fails because of what it finds: the exit status is 0 whether or not
#     anything matched. It does fail if the input cannot be read, because a scan that
#     silently read nothing would look like a clean bill of health;
#   - the patterns lean precise over broad. CI logs and review comments on these PRs
#     legitimately mention tokens, workflows and shell commands, and a tripwire that
#     fires on every run teaches the reader to ignore it.
set -euo pipefail

# Byte-wise matching: the invisible-character patterns below are UTF-8 byte sequences,
# and `-i` must not depend on whatever locale the runner happens to have.
export LC_ALL=C

# Plain `cat` for stdin: /dev/stdin cannot be reopened when stdin is a socket.
if [ $# -ge 1 ]; then text="$(cat -- "$1")"; else text="$(cat)"; fi

has() { grep -qiE -e "$1" <<<"$text"; }

# "ignore all previous instructions" and its relatives.
if has '(ignore|disregard|forget|override)[[:space:]]+((all|any|the|your|these|my)[[:space:]]+)*(previous|prior|above|earlier|preceding|original|system|initial)[[:space:]]+(instruction|prompt|rule|guideline|direction|message)s?' \
  || has 'new[[:space:]]+instructions?[[:space:]]*:' \
  || has 'from[[:space:]]+now[[:space:]]+on,?[[:space:]]+you' \
  || has 'you[[:space:]]+are[[:space:]]+now[[:space:]]+(an?[[:space:]]|in[[:space:]]|no[[:space:]]+longer|dan([^[:alnum:]]|$)|unrestricted|free)'; then
  echo override-instructions
fi

# Chat-template and role markers, as a line prefix or as special tokens.
if has '^[[:space:]>*#_-]*(system|assistant)[[:space:]]*:' \
  || has '<\|(im_start|im_end|system|endoftext)\|>' \
  || has '\[/?INST\]|<</?SYS>>|</?(system|assistant)>'; then
  echo role-marker
fi

# Fetch-and-run, decode-and-run and reverse-shell idioms.
if has '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da|k)?sh([[:space:]]|$)' \
  || has 'base64[[:space:]]+(-d|--decode)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da|k)?sh([[:space:]]|$)' \
  || has '/dev/tcp/' \
  || has 'bash[[:space:]]+-i([[:space:]]|$)'; then
  echo remote-code
fi

# Reading or sending credentials. A bare `GITHUB_TOKEN` is not enough: Actions prints
# `GITHUB_TOKEN: ***` in the env block of every step, so a verb has to come first.
if has 'printenv|/proc/[a-z0-9]+/environ|\.git-credentials|\.ssh/id_|id_rsa|\.config/gh/hosts' \
  || has '(print|echo|cat|dump|send|post|upload|exfiltrat|leak|reveal|curl|wget|base64)[^[:cntrl:]]{0,60}(GITHUB_TOKEN|GH_TOKEN|ACTIONS_ID_TOKEN|ACTIONS_RUNTIME_TOKEN|COPILOT_GITHUB_TOKEN|APP_PRIVATE_KEY|VAULT_)'; then
  echo credential-access
fi

# Asking the agent to change the CI that constrains it. The agent is meant to stay in the
# example surface, so this is out of scope however politely it is phrased.
if has '(edit|modify|change|update|add|create|write|delete|overwrite|append)[^[:cntrl:]]{0,50}\.github/(workflows|actions)/'; then
  echo workflow-edit
fi

# A long run of base64 alphabet: a payload the agent is expected to decode, or smuggled
# text. 120 characters keeps lockfile integrity hashes (88) and ordinary paths clear.
if has '[A-Za-z0-9+/]{120,}={0,2}'; then
  echo encoded-blob
fi

# Characters a reviewer cannot see: zero-width space, bidirectional overrides and
# isolates, word joiner, byte-order mark, and the Unicode tag block used to smuggle ASCII.
# ZWJ/ZWNJ and the directional marks are left out on purpose: emoji sequences and
# right-to-left text use them legitimately.
hidden="$(printf '\342\200[\213\252-\256]|\342\201[\240\246-\251]|\357\273\277|\363\240[\200\201][\200-\277]')"
if has "$hidden"; then
  echo hidden-characters
fi
