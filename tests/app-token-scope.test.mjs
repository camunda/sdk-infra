import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A GitHub App installation usually covers many repositories. Every minted
// token must say which ones it is for, or it inherits the whole installation.

const WORKFLOWS = join(new URL('..', import.meta.url).pathname, '.github/workflows');

test('every create-github-app-token step sets repositories', () => {
  const offenders = [];
  let seen = 0;
  for (const name of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    const lines = readFileSync(join(WORKFLOWS, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^\s*(?:-\s+)?uses:\s*actions\/create-github-app-token@/.test(line)) return;
      seen += 1;
      // The step's `with:` block runs until the next step (`- name:`/`- uses:`).
      let end = i + 1;
      while (end < lines.length && !/^\s*-\s+(name|uses|id|run):/.test(lines[end])) end += 1;
      const block = lines.slice(i, end).filter((l) => !/^\s*#/.test(l)).join('\n');
      if (!/^\s*repositories:\s*\S+/m.test(block)) offenders.push(`${name}:${i + 1}`);
    });
  }
  assert.ok(seen > 0, 'expected to find create-github-app-token steps');
  assert.deepEqual(offenders, [], `tokens without repositories:\n${offenders.join('\n')}`);
});
