// Tests for scripts/issue-triage.mjs, the rules behind sdk-issue-labels.yml.
// Uses node:test (zero dependencies). Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triage } from '../scripts/issue-triage.mjs';

const available = ['bug', 'enhancement', 'documentation', 'question', 'needs-triage', 'affects/main', 'affects/stable',
  'severity/critical', 'severity/high', 'severity/medium', 'severity/low',
  'found-by/user', 'found-by/review', 'found-by/ci', 'found-by/conformance-test', 'found-by/performance-test', 'found-by/integration', 'found-by/manual-test', 'found-by/audit'];
const base = { team: ['jwulf', 'emilyoram'], botPattern: '\\[bot\\]$|^renovate', available };

test('issue form answers become labels', () => {
  const body = '### What happened?\n\nIt broke\n\n### How was this found?\n\nCI (build, tests, publish)\n\n### Which release line?\n\nBoth\n\n### Severity\n\nHigh: core feature broken\n\n### Introduced-by\n\n_No response_';
  const r = triage({ ...base, body, labels: ['bug'], author: 'jwulf' });
  assert.deepEqual(r.add.sort(), ['affects/main', 'affects/stable', 'found-by/ci', 'severity/high']);
  assert.equal(r.comment, null);
});

test('API trailer lines become labels, including the type', () => {
  const body = 'Something is wrong.\n\nType: bug\nFound-by: conformance-test\nAffects: main\nSeverity: medium\nIntroduced-by: abc1234';
  const r = triage({ ...base, body, labels: [], author: 'jwulf' });
  assert.deepEqual(r.add.sort(), ['affects/main', 'bug', 'found-by/conformance-test', 'severity/medium']);
  assert.deepEqual(r.missing, []);
});

test('outside reporters default to found-by/user; missing fields get needs-triage and a comment', () => {
  const r = triage({ ...base, body: 'It crashes', labels: ['bug'], author: 'someone' });
  assert.deepEqual(r.add.sort(), ['found-by/user', 'needs-triage']);
  assert.deepEqual(r.missing, ['release line', 'severity']);
  assert.match(r.comment, /Affects: main \| stable \| both/);
});

test('team bug without found-by is flagged, not guessed', () => {
  const r = triage({ ...base, body: 'x', labels: ['bug', 'affects/main', 'severity/low'], author: 'emilyoram' });
  assert.deepEqual(r.missing, ['found-by']);
});

test('existing labels win and complete issues drop needs-triage', () => {
  const body = 'Found-by: ci';
  const r = triage({ ...base, body, labels: ['bug', 'found-by/review', 'affects/stable', 'severity/low', 'needs-triage'], author: 'jwulf' });
  assert.deepEqual(r.add, []);
  assert.equal(r.removeTriage, true);
  assert.equal(r.comment, null);
});

test('non-bugs only get their type', () => {
  assert.deepEqual(triage({ ...base, body: 'Type: enhancement', labels: [], author: 'x' }).add, ['enhancement']);
});

test('bots and agents are read like the team: never defaulted to found-by/user', () => {
  const r = triage({ ...base, body: 'Found-by: ci\nAffects: main', labels: ['bug'], author: 'copilot-swe-agent[bot]' });
  assert.deepEqual(r.add.sort(), ['affects/main', 'found-by/ci', 'needs-triage']);
  assert.deepEqual(r.missing, ['severity']);
  assert.deepEqual(triage({ ...base, body: 'x', labels: ['bug'], author: 'renovate[bot]' }).missing, ['found-by', 'release line', 'severity']);
});

test('labels the repo does not have are never added', () => {
  const r = triage({ ...base, available: ['bug'], body: 'Found-by: ci\nAffects: main', labels: ['bug'], author: 'jwulf' });
  assert.deepEqual(r.add, []);
});

test("form \"Don't know\" answers fall through to trailer lines", () => {
  const body = "### Which release line?\n\nDon't know\n\n### Severity\n\nDon’t know\n\nAffects: stable\nSeverity: high\nFound-by: ci";
  const r = triage({ ...base, body, labels: ['bug'], author: 'jwulf' });
  assert.deepEqual(r.add.sort(), ['affects/stable', 'found-by/ci', 'severity/high']);
  assert.equal(r.comment, null);
});
