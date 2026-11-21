import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/api-compat.sh owns the policy behind sdk-api-compat.yml. These tests drive it
// with a fake compare command whose exit code is the verdict.

const SCRIPT = fileURLToPath(new URL('../scripts/api-compat.sh', import.meta.url));

function fixture(tags) {
  const dir = mkdtempSync(join(tmpdir(), 'api-compat-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const t of tags) git('tag', t);
  const base = join(dir, 'base');
  mkdirSync(base);
  const fake = join(dir, 'compare.sh');
  // Records its arguments, then exits with $FAKE_RC.
  writeFileSync(fake, '#!/usr/bin/env bash\necho "compare $1 $2" > "$FAKE_LOG"\necho "removed: Foo"\nexit "$FAKE_RC"\n');
  chmodSync(fake, 0o755);
  return { dir, repo, base, fake };
}

function run(f, { rc = 0, mode = 'pr', approved = 'false', major = '8', pattern = '' } = {}) {
  const summary = join(f.dir, 'summary.md');
  writeFileSync(summary, '');
  const log = join(f.dir, 'log');
  writeFileSync(log, '');
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      RUNNER_TEMP: f.dir,
      GITHUB_STEP_SUMMARY: summary,
      FAKE_RC: String(rc),
      FAKE_LOG: log,
      API_COMPAT_MODE: mode,
      API_COMPAT_MAJOR: major,
      API_COMPAT_COMPARE: f.fake,
      API_COMPAT_NEW_DIR: f.repo,
      API_COMPAT_OLD_DIR: f.base,
      API_COMPAT_APPROVED: approved,
      API_COMPAT_TAG_PATTERN: pattern,
    },
  });
  return { ...r, summary: readFileSync(summary, 'utf8'), log: readFileSync(log, 'utf8') };
}

test('pass: no breaks exits 0 and compares base with head', () => {
  const f = fixture(['v8.1.0']);
  const r = run(f);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.log.trim(), `compare ${f.base} ${f.repo}`);
  assert.match(r.summary, /## API compatibility \(against base branch\)/);
});

test('break: exits 1 with the label hint', () => {
  const r = run(fixture(['v8.1.0']), { rc: 1 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::.*api-break-approved label/);
  assert.match(r.summary, /removed: Foo/);
});

test('approved break: passes, still lists the breaks', () => {
  const r = run(fixture(['v8.1.0']), { rc: 1, approved: 'true' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning::Breaking API changes approved/);
  assert.match(r.summary, /removed: Foo[\s\S]*Approved with the `api-break-approved` label/);
});

test('no release yet: passes without running the tool', () => {
  // A prerelease and another major's release do not count.
  const r = run(fixture(['v8.0.0-alpha.1', 'v7.3.0']), { rc: 1 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::notice::No 8\.x release published yet/);
  assert.equal(r.log, '');
});

test('tool error: exits 2 even when approved', () => {
  const r = run(fixture(['v8.1.0']), { rc: 3, approved: 'true' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /::error::API compatibility tool failed \(exit 3\)/);
});

test('release mode: compares with the latest published release of the major', () => {
  const f = fixture(['v8.1.0', 'v8.10.0', 'v8.11.0-alpha.1', 'v9.0.0']);
  const r = run(f, { mode: 'release' });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.log.trim(), `compare ${join(f.dir, 'api-compat-baseline')} ${f.repo}`);
  assert.match(r.summary, /against last release v8\.10\.0/);
});

test('custom tag pattern', () => {
  const r = run(fixture(['sdk-8.2.0']), { mode: 'release', pattern: 'sdk-{major}.*' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.summary, /last release sdk-8\.2\.0/);
});

test('missing major is a setup error', () => {
  const r = run(fixture(['v8.1.0']), { major: '' });
  assert.equal(r.status, 2);
});
