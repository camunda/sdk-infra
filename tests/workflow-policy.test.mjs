import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The agent and auto-merge workflows decide, in embedded bash, who may start a
// privileged run and what may be merged unattended. Nothing else exercises those
// decisions, so these tests pin the invariants that must never be dropped. They
// read the workflow text on purpose: the gates are the text.

const WORKFLOWS = join(new URL('..', import.meta.url).pathname, '.github/workflows');
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
  assert.match(text, /"\/agent fix"\*\)/, 'command must be matched at the start of the comment');
  const gate = /case "\$COMMENT_ASSOC" in\s*OWNER\|MEMBER\|COLLABORATOR\) ;;\s*\*\)/;
  assert.match(text, gate, 'author_association must be limited to OWNER|MEMBER|COLLABORATOR');
});

test('the follow-up agent ignores its own comments', () => {
  const text = code(read('sdk-agent-pr-followup.yml'));
  assert.match(text, /is_self "\$COMMENT_AUTHOR" && \{/);
  assert.match(text, /github-actions\\\[bot\\\]\|camunda-sdk-automation\\\[bot\\\]\) return 0/);
});

test('agent candidate selection excludes fork heads', () => {
  for (const name of ['sdk-agent-pr-followup.yml', 'sdk-agent-auto-merge.yml']) {
    assert.match(
      code(read(name)),
      /headRepositoryOwner\.login == (env\.GITHUB_REPOSITORY_OWNER|\\"\$\{GITHUB_REPOSITORY_OWNER\}\\")/,
      `${name} must only consider PRs whose head repo belongs to the repository owner`,
    );
  }
});

test('auto-merge only queues bot-authored, non-draft, non-held PRs', () => {
  const text = code(read('sdk-agent-auto-merge.yml'));
  assert.match(text, /\.author\.is_bot == true/, 'author must be a bot account');
  assert.match(text, /select\(\.isDraft == false\)/, 'drafts must be excluded');
  assert.match(text, /\.name == \$l/, 'the hold label must be honoured');
  assert.match(text, /startswith\(env\.AGENT_BRANCH_PREFIX\)/, 'only agent branches are eligible');
  assert.match(text, /--disable-auto/, 'auto-merge must be withdrawn when a PR stops qualifying');
});

test('jobs that run the Copilot CLI declare explicit permissions', () => {
  for (const name of ['sdk-agent-pr-followup.yml', 'sdk-agent-example-coverage.yml']) {
    const text = code(read(name));
    const jobs = text.split(/\n  (?=[a-z][a-z0-9-]*:\n)/).filter((j) => /copilot --yolo|copilot -p|@github\/copilot/.test(j));
    assert.ok(jobs.length > 0, `${name}: expected a job that runs the Copilot CLI`);
    for (const job of jobs) {
      assert.match(job, /\n    permissions:\n/, `${name}: a Copilot job has no explicit permissions`);
    }
  }
});

test('comment and review text reaches the agent through a file, not an expansion in the prompt', () => {
  const text = code(read('sdk-agent-pr-followup.yml'));
  assert.match(text, /printf '%s\\n' "\$COMMENT_BODY" > \/tmp\/feedback\.md/);
  assert.doesNotMatch(text, /\$\{\{\s*github\.event\.comment\.body\s*\}\}[^\n]*\n[^\n]*copilot/);
});
