import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  matchGlob,
  loadConfig,
  planBackport,
  planFromFiles,
  DEFAULTS,
} from '../scripts/plan-backport.mjs';

const script = fileURLToPath(new URL('../scripts/plan-backport.mjs', import.meta.url));

describe('matchGlob', () => {
  it('matches ** across directories and * within a segment', () => {
    assert.equal(matchGlob('src/gen/**', 'src/gen/foo.ts'), true);
    assert.equal(matchGlob('src/gen/**', 'src/gen/a/b.ts'), true);
    assert.equal(matchGlob('src/gen/**', 'src/runtime/foo.ts'), false);
    assert.equal(matchGlob('*.md', 'README.md'), true);
    assert.equal(matchGlob('*.md', 'docs/README.md'), true);
    assert.equal(matchGlob('docs/*.md', 'docs/README.md'), true);
    assert.equal(matchGlob('docs/*.md', 'docs/a/README.md'), false);
  });
});

describe('parseYaml / loadConfig', () => {
  it('uses schema defaults for an empty file', () => {
    assert.deepEqual(loadConfig(''), DEFAULTS);
    assert.deepEqual(loadConfig('# just a comment\n'), DEFAULTS);
  });

  it('reads skip-paths and skip-subjects lists', () => {
    const cfg = loadConfig(`
skip-paths:
  - generated/**
  - src/gen/**
skip-subjects:
  - 'chore(gen):'
  - 'chore(regen):'
`);
    assert.deepEqual(cfg['skip-paths'], ['generated/**', 'src/gen/**']);
    assert.deepEqual(cfg['skip-subjects'], ['chore(gen):', 'chore(regen):']);
    assert.deepEqual(cfg['do-not-backport'], []);
  });

  it('reads a do-not-backport rule with from/to', () => {
    const cfg = loadConfig(`
do-not-backport:
  - paths:
      - generator/**
    from:
      - main
      - stable/9
    to:
      - stable/10
`);
    assert.equal(cfg['do-not-backport'].length, 1);
    assert.deepEqual(cfg['do-not-backport'][0].paths, ['generator/**']);
    assert.deepEqual(cfg['do-not-backport'][0].from, ['main', 'stable/9']);
    assert.deepEqual(cfg['do-not-backport'][0].to, ['stable/10']);
  });
});

const jsConfig = loadConfig(`
skip-paths:
  - src/gen/**
  - external-spec/**
  - spec-snapshots/**
skip-subjects:
  - 'chore(gen):'
  - 'chore(regen):'
`);

describe('planBackport', () => {
  it('keeps a handwritten-only commit', () => {
    const plan = planBackport(
      [{ sha: 'aaa', subject: 'fix: retry activation', files: ['src/runtime/worker.ts'] }],
      jsConfig,
      'main',
      'stable/10',
    );
    assert.equal(plan.action, 'cherry-pick');
    assert.deepEqual(plan.shas, ['aaa']);
  });

  it('drops a regen-only commit by subject and by path', () => {
    const plan = planBackport(
      [
        { sha: 'bbb', subject: 'chore(gen): regenerate for retry', files: ['src/gen/types.ts'] },
        { sha: 'ccc', subject: 'chore: snapshot spec', files: ['external-spec/rest.json'] },
      ],
      jsConfig,
      'main',
      'stable/10',
    );
    assert.equal(plan.action, 'skip');
    assert.match(plan.reason, /nothing-handwritten/);
    assert.equal(plan.shas.length, 0);
  });

  it('fails a mixed handwritten+generated commit', () => {
    const plan = planBackport(
      [
        {
          sha: 'ddd',
          subject: 'fix: retry and regen',
          files: ['src/runtime/worker.ts', 'src/gen/types.ts'],
        },
      ],
      jsConfig,
      'main',
      'stable/10',
    );
    assert.equal(plan.action, 'fail');
    assert.match(plan.reason, /mixed-commit/);
    assert.equal(plan.mixed.length, 1);
    assert.deepEqual(plan.mixed[0].handwritten, ['src/runtime/worker.ts']);
    assert.deepEqual(plan.mixed[0].generated, ['src/gen/types.ts']);
  });

  it('keeps the handwritten commit of a two-commit PR and drops the regen', () => {
    const plan = planBackport(
      [
        { sha: 'eee', subject: 'fix: generator emits retry', files: ['hooks/post/retry.ts'] },
        { sha: 'fff', subject: 'chore(gen): regenerate for retry', files: ['src/gen/client.ts'] },
      ],
      jsConfig,
      'main',
      'stable/10',
    );
    assert.equal(plan.action, 'cherry-pick');
    assert.deepEqual(plan.shas, ['eee']);
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].sha, 'fff');
  });

  it('skips when remaining paths hit a do-not-backport rule for these lines', () => {
    const csharp = loadConfig(`
skip-paths:
  - src/gen/**
do-not-backport:
  - paths:
      - generator/**
    from:
      - main
    to:
      - stable/9
`);
    const plan = planBackport(
      [{ sha: 'ggg', subject: 'fix: generator handles allOf', files: ['generator/AllOf.cs'] }],
      csharp,
      'main',
      'stable/9',
    );
    assert.equal(plan.action, 'skip');
    assert.match(plan.reason, /do-not-backport/);
    assert.equal(plan.blocked.length, 1);
  });

  it('does not apply a do-not-backport rule to a different target', () => {
    const csharp = loadConfig(`
do-not-backport:
  - paths: [generator/**]
    from: [main]
    to: [stable/9]
`);
    const plan = planBackport(
      [{ sha: 'hhh', subject: 'fix: generator handles allOf', files: ['generator/AllOf.cs'] }],
      csharp,
      'main',
      'stable/10',
    );
    assert.equal(plan.action, 'cherry-pick');
    assert.deepEqual(plan.shas, ['hhh']);
  });
});

describe('planFromFiles / CLI', () => {
  it('fails when the config file is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plan-backport-'));
    try {
      const commits = path.join(dir, 'commits.json');
      writeFileSync(commits, '[]');
      const plan = planFromFiles({
        configPath: path.join(dir, 'missing.yml'),
        commitsPath: commits,
        source: 'main',
        target: 'stable/10',
      });
      assert.equal(plan.action, 'fail');
      assert.match(plan.reason, /missing-config/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the CLI prints a cherry-pick plan as JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plan-backport-cli-'));
    try {
      const config = path.join(dir, 'backport.yml');
      const commits = path.join(dir, 'commits.json');
      writeFileSync(config, 'skip-paths:\n  - src/gen/**\n');
      writeFileSync(
        commits,
        JSON.stringify([{ sha: 'abc', subject: 'fix: x', files: ['src/runtime/a.ts'] }]),
      );
      const out = execFileSync(
        process.execPath,
        [script, '--config', config, '--commits', commits, '--source', 'main', '--target', 'stable/10'],
        { encoding: 'utf8' },
      );
      const plan = JSON.parse(out);
      assert.equal(plan.action, 'cherry-pick');
      assert.deepEqual(plan.shas, ['abc']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
