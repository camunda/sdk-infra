import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blockedFiles,
  isGenerated,
  main,
  matchGlob,
  outsideGenerated,
  readFileList,
  resolve,
  validateConfig,
} from '../scripts/backport-config.mjs';

const GO = {
  language: 'go',
  'generated-paths': ['external-spec', 'client', 'pb', 'facade_generated.go'],
  regenerate: './scripts/generate.sh',
};

test('matchGlob: ** spans directories, * stays within one, bare names match at any depth', () => {
  assert.ok(matchGlob('src/**/*.cs', 'src/a/b/C.cs'));
  assert.ok(matchGlob('src/**/*.cs', 'src/C.cs'));
  assert.ok(!matchGlob('src/*.cs', 'src/a/C.cs'));
  assert.ok(matchGlob('*.hbs', 'templates/deep/x.hbs'));
  assert.ok(matchGlob('./scripts/gen/**', 'scripts/gen/a/b.py'));
  assert.ok(!matchGlob('scripts/gen/**', 'scripts/generate.sh'));
  assert.ok(matchGlob('a.b', 'a.b') && !matchGlob('a.b', 'axb'), 'dots are literal');
});

test('isGenerated: a path is a file or a directory prefix, never a string prefix', () => {
  assert.ok(isGenerated(GO['generated-paths'], 'client/model_job.go'));
  assert.ok(isGenerated(GO['generated-paths'], 'facade_generated.go'));
  assert.ok(isGenerated(['client/'], 'client/x.go'), 'a trailing slash is tolerated');
  assert.ok(!isGenerated(GO['generated-paths'], 'clientutil/x.go'));
  assert.ok(!isGenerated(GO['generated-paths'], 'camunda.go'));
});

test('validateConfig accepts the documented shapes', () => {
  assert.deepEqual(validateConfig(GO), []);
  assert.deepEqual(validateConfig({ 'generated-paths': [] }), [], 'regeneration off needs no command');
  assert.deepEqual(
    validateConfig({
      'generated-paths': ['generated'],
      regenerate: 'make generate-only',
      'do-not-backport': [{ paths: ['scripts/gen/**'], from: ['main'], reason: 'generator diverged' }],
    }),
    [],
  );
});

test('validateConfig rejects what the workflow could not act on', () => {
  const bad = (cfg, re) => assert.ok(validateConfig(cfg).some((e) => re.test(e)), `${JSON.stringify(cfg)} → ${re}`);
  bad(null, /empty or not a mapping/);
  bad([], /not a mapping/);
  bad({}, /generated-paths is required/);
  bad({ 'generated-paths': ['client'] }, /regenerate .* is required/);
  bad({ 'generated-paths': ['client'], regenerate: '  ' }, /regenerate .* is required/);
  bad({ ...GO, language: 'cobol' }, /language must be one of/);
  bad({ ...GO, 'generated-paths': ['src/**/*.g.cs'] }, /is a glob/);
  bad({ ...GO, 'generated-paths': ['/abs'] }, /relative to the repo root/);
  bad({ ...GO, 'generated-paths': ['../x'] }, /relative to the repo root/);
  bad({ ...GO, 'generated-paths': ['a', 'a'] }, /duplicate/);
  bad({ ...GO, 'generated-path': [] }, /unknown key "generated-path"/);
  bad({ ...GO, 'do-not-backport': {} }, /must be a list/);
  bad({ ...GO, 'do-not-backport': [{ paths: [] }] }, /paths must be a non-empty list/);
  bad({ ...GO, 'do-not-backport': [{ paths: ['x'], to: ['stable/9'] }] }, /unknown key "to"/);
  bad({ ...GO, 'do-not-backport': [{ paths: ['x'], from: 'main' }] }, /from must be a list/);
});

test('blockedFiles applies rules by source branch', () => {
  const cfg = { ...GO, 'do-not-backport': [{ paths: ['scripts/gen/**'], from: ['main'], reason: 'diverged' }, { paths: ['*.lock'] }] };
  const changed = ['scripts/gen/emit.py', 'camunda.go', 'deps/x.lock'];
  assert.deepEqual(blockedFiles(cfg, { from: 'main', changed }), [
    { file: 'scripts/gen/emit.py', pattern: 'scripts/gen/**', reason: 'diverged' },
    { file: 'deps/x.lock', pattern: '*.lock', reason: '' },
  ]);
  assert.deepEqual(blockedFiles(cfg, { from: 'stable/10', changed }), [{ file: 'deps/x.lock', pattern: '*.lock', reason: '' }]);
  assert.deepEqual(blockedFiles(GO, { from: 'main', changed }), []);
});

test('resolve fills defaults', () => {
  assert.deepEqual(resolve({ 'generated-paths': [] }, { from: 'main', changed: [] }), {
    language: '',
    generatedPaths: [],
    regenerate: '',
    blocked: [],
  });
});

test('outsideGenerated lists every non-generated file', () => {
  assert.deepEqual(outsideGenerated(GO, ['client/a.go', 'camunda.go', 'pb/x.pb.go', 'README.md']), ['camunda.go', 'README.md']);
});

function run(argv) {
  let out = '';
  let err = '';
  const code = main(argv, { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } });
  return { code, out, err };
}

test('CLI: resolve, check-diff and invalid config exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backport-config-'));
  const cfg = join(dir, 'cfg.json');
  const changed = join(dir, 'changed.txt');
  writeFileSync(cfg, JSON.stringify(GO));
  writeFileSync(changed, 'client/a.go\n\npb/b.go\n');

  const r = run(['resolve', '--config', cfg, '--from', 'main', '--changed', changed]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { language: 'go', generatedPaths: GO['generated-paths'], regenerate: './scripts/generate.sh', blocked: [] });

  assert.equal(run(['check-diff', '--config', cfg, '--changed', changed]).code, 0);
  writeFileSync(changed, 'client/a.go\ncamunda.go\n');
  const c = run(['check-diff', '--config', cfg, '--changed', changed]);
  assert.equal(c.code, 1);
  assert.match(c.err, /::error::camunda\.go is not a generated path/);

  // `yq -o=json` of an empty file is `null`.
  writeFileSync(cfg, 'null\n');
  const e = run(['resolve', '--config', cfg]);
  assert.equal(e.code, 2);
  assert.match(e.err, /::error::\.github\/backport\.yml: the file is empty/);

  assert.throws(() => run(['frobnicate', '--config', join(dir, 'cfg.json')]), /unknown command/);
});

test('file lists keep names byte for byte, so whitespace cannot fake a generated path', () => {
  assert.deepEqual(readFileList('client/a.go\0 client/b.go\0'), ['client/a.go', ' client/b.go']);
  assert.deepEqual(readFileList('a\nb\n'), ['a', 'b']);
  assert.deepEqual(outsideGenerated(GO, readFileList('client/a.go\0 client/runtime.go\0')), [' client/runtime.go']);
  const dir = mkdtempSync(join(tmpdir(), 'backport-config-'));
  writeFileSync(join(dir, 'cfg.json'), JSON.stringify(GO));
  writeFileSync(join(dir, 'diff.txt'), 'client/a.go\0 client/runtime.go\0');
  assert.equal(run(['check-diff', '--config', join(dir, 'cfg.json'), '--changed', join(dir, 'diff.txt')]).code, 1);
});

test('globs match file names containing newlines', () => {
  assert.ok(matchGlob('scripts/gen/**', 'scripts/gen/a\nb.py'));
  assert.ok(matchGlob('*.py', 'x/a\nb.py'));
  const cfg = { ...GO, 'do-not-backport': [{ paths: ['scripts/gen/**'] }] };
  assert.equal(blockedFiles(cfg, { from: 'main', changed: readFileList('scripts/gen/evil\nname.py\0') }).length, 1);
});
