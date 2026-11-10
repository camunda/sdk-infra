import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The agent and auto-merge workflows decide, in embedded bash, who may start a
// privileged run and what may be merged unattended. Nothing else exercises those
// decisions, so these tests pin the invariants that must never be dropped. They
// read the workflow text on purpose: the gates are the text.

const WORKFLOWS = join(fileURLToPath(new URL('..', import.meta.url)), '.github/workflows');
const read = (name) => readFileSync(join(WORKFLOWS, name), 'utf8');
const all = readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n));
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('pull_request_target is confined to the Slack notifier, which never checks out code', () => {
  // sdk-slack-community-notify.yml is designed to be called from pull_request_target
  // so that fork PRs can be announced. That is safe only while it never checks out
  // or executes PR-controlled code, so both halves are pinned here.
  const allowed = 'sdk-slack-community-notify.yml';
  for (const name of all) {
    const text = code(read(name));
    if (name === allowed) {
      assert.doesNotMatch(text, /actions\/checkout|git (clone|checkout|fetch)|gh pr checkout/, `${name} must not check out PR code`);
    } else {
      assert.doesNotMatch(text, /pull_request_target/, `${name} must not use pull_request_target`);
    }
  }
});

test('/agent fix is limited to repository collaborators', () => {
  const text = code(read('sdk-agent-pr-followup.yml'));
  assert.match(
    text,
    /case "\$first_line" in\n\s*"\/agent fix"\*\) ;;\n\s*\*\)[^\n]*\bexit 0 ;;\n\s*esac/,
    'only a comment whose first line starts with /agent fix may continue',
  );
  const gate = /case "\$COMMENT_ASSOC" in\s*OWNER\|MEMBER\|COLLABORATOR\) ;;\s*\*\)/;
  assert.match(text, gate, 'author_association must be limited to OWNER|MEMBER|COLLABORATOR');
  // The default arm must stop the run before the PR is selected; matching the arm alone
  // would still pass if its `exit 0` were dropped and non-collaborators fell through.
  const rejects = /\*\)(?:(?!;;)[\s\S])*?\n\s*exit 0\s*\n\s*;;\s*\n\s*esac\s*\n\s*pr="\$ISSUE_PR_NUMBER"/;
  assert.match(text, rejects, 'non-collaborators must exit before the pull request is selected');
});

test('the follow-up agent ignores its own comments and reviews', () => {
  const text = code(read('sdk-agent-pr-followup.yml'));
  assert.match(text, /github-actions\\\[bot\\\]\|camunda-sdk-automation\\\[bot\\\]\) return 0/);
  assert.match(text, /is_self "\$COMMENT_AUTHOR" && \{[^}\n]*\bexit 0; \}/, 'an own comment must end the run');
  assert.match(
    text,
    /if is_self "\$\{found#\* \}"; then\n(?:(?!\n\s*fi\b)[\s\S])*?\n\s*continue\n\s*fi\b/,
    'an own review must skip the pull request',
  );
});

test('agent candidate selection excludes fork heads', () => {
  // Every selection path lists PRs separately, so each `gh pr list` needs its own filter.
  const OWNER_FILTER = /headRepositoryOwner\.login == (env\.GITHUB_REPOSITORY_OWNER|\\"\$\{GITHUB_REPOSITORY_OWNER\}\\")/;
  for (const name of ['sdk-agent-pr-followup.yml', 'sdk-agent-auto-merge.yml']) {
    const lines = code(read(name)).split('\n');
    const calls = lines.flatMap((l, i) => (/gh pr list\b/.test(l) ? [i] : []));
    assert.ok(calls.length > 0, `${name}: expected a gh pr list selection`);
    for (const [n, i] of calls.entries()) {
      // The --jq filter spans several quoted lines; look a few lines on, but never into the next call.
      const end = Math.min(i + 10, calls[n + 1] ?? lines.length);
      assert.match(
        lines.slice(i, end).join('\n'),
        OWNER_FILTER,
        `${name}:${i + 1}: this selection must only consider PRs whose head repo belongs to the repository owner`,
      );
    }
  }
});

test('auto-merge only queues bot-authored, non-draft, non-held PRs', () => {
  const text = code(read('sdk-agent-auto-merge.yml'));
  // The negation is the gate: without `!` bots would be rejected and humans let through.
  assert.match(
    text,
    /if ! jq -e '\.author\.is_bot == true' \/tmp\/pr\.json >\/dev\/null; then\n(?:(?!\n\s*fi\b)[\s\S])*?\n\s*return\n/,
    'a PR whose author is not a bot must be rejected',
  );
  assert.match(text, /select\(\.isDraft == false\)/, 'drafts must be excluded');
  assert.match(
    text,
    /if jq -e --arg l "\$HOLD_LABEL" 'any\(\.labels\[\]; \.name == \$l\)' \/tmp\/pr\.json >\/dev\/null; then\n(?:(?!\n\s*fi\b)[\s\S])*?\n\s*return\n/,
    'a PR carrying the hold label must be rejected',
  );
  assert.match(text, /startswith\(env\.AGENT_BRANCH_PREFIX\)/, 'only agent branches are eligible');
  assert.match(text, /--disable-auto/, 'auto-merge must be withdrawn when a PR stops qualifying');
});

test('jobs that run the Copilot CLI declare explicit permissions', () => {
  for (const name of ['sdk-agent-pr-followup.yml', 'sdk-agent-example-coverage.yml']) {
    const text = code(read(name));
    const jobsAt = text.indexOf('\njobs:\n');
    assert.ok(jobsAt >= 0, `${name}: expected a jobs: section`);
    // Job IDs may contain `_` and start with a letter or `_`; anything narrower lets one job's
    // block swallow the next, so its permissions could satisfy the check for both.
    const jobs = text
      .slice(jobsAt)
      .split(/\n  (?=[A-Za-z_][A-Za-z0-9_-]*:[ \t]*\n)/)
      .filter((j) => /copilot --yolo|copilot -p|@github\/copilot/.test(j));
    assert.ok(jobs.length > 0, `${name}: expected a job that runs the Copilot CLI`);
    for (const job of jobs) {
      assert.match(job, /\n    permissions:/, `${name}: a Copilot job has no explicit permissions`);
    }
  }
});

test('comment and review text reaches the agent through a file, not an expansion in the prompt', () => {
  const text = code(read('sdk-agent-pr-followup.yml'));
  assert.match(text, /printf '%s\\n' "\$COMMENT_BODY" > \/tmp\/feedback\.md/);
  const step = /\n\s+- name: Run Copilot CLI\n([\s\S]*?)(?=\n\s+- name: )/.exec(text);
  assert.ok(step, 'expected a "Run Copilot CLI" step');
  const agent = step[1];
  assert.match(agent, /\{\n[\s\S]*sed 's\/\^\/  \/' \/tmp\/feedback\.md\n[\s\S]*\} > \/tmp\/prompt\.md/, 'the prompt must include the feedback file');
  assert.match(agent, /copilot --yolo -p "\$\(cat \/tmp\/prompt\.md\)"/, 'the agent must be given the assembled prompt');
  assert.doesNotMatch(agent, /\$\{?(COMMENT_BODY|REVIEW_BODY)\b|\$\{\{\s*github\.event\./, 'the agent step must not read feedback text directly');
});

test('user-controlled event text is only ever bound to an env var', () => {
  // `${{ }}` is substituted into the script before bash parses it, so a title or body
  // expanded inside `run:` (or a prompt) is code injection. An env var is passed as data.
  // Any expression that reads the field counts, not just a bare one: `|| ''` or toJSON()
  // still substitute the text into the script.
  const UNTRUSTED =
    /\$\{\{(?:(?!\}\}).)*github\.event\.(comment|review|issue|pull_request|discussion)\.(body|title)\b(?:(?!\}\}).)*\}\}/;
  const ENV_BINDING = /^\s+[A-Za-z_][A-Za-z0-9_]*:\s*\$\{\{(?:(?!\}\}).)*\}\}\s*$/;
  const indent = (l) => /^ */.exec(l)[0].length;
  // Lines inside a `key: |` / `key: >` block scalar are text (a script, a heredoc), however
  // YAML-like they look.
  const blockScalarLines = (lines) => {
    const inside = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^(\s*(?:-\s+)?)[^\s#][^:]*:\s*[|>][-+0-9]*\s*(?:#.*)?$/.exec(lines[i]);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > m[1].length)) inside.add(j++);
      i = j - 1;
    }
    return inside;
  };
  const offenders = [];
  let seen = 0;
  for (const name of all) {
    const lines = read(name).split('\n');
    const scalar = blockScalarLines(lines);
    const isYamlComment = (k) => !scalar.has(k) && /^\s*#/.test(lines[k]);
    lines.forEach((line, i) => {
      if (!UNTRUSTED.test(line) || isYamlComment(i)) return;
      seen += 1;
      let p = i - 1;
      while (p >= 0 && (lines[p].trim() === '' || isYamlComment(p) || indent(lines[p]) >= indent(line))) p -= 1;
      const inEnv = !scalar.has(i) && p >= 0 && /^\s*env:\s*$/.test(lines[p]);
      if (!inEnv || !ENV_BINDING.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.ok(seen > 0, 'expected at least one env binding of event text');
  assert.deepEqual(offenders, [], `event text expanded outside an env binding:\n${offenders.join('\n')}`);
});
