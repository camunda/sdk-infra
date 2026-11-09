import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every third-party `uses:` must name a full commit SHA, never a mutable tag.
// References to this repo itself (`camunda/sdk-infra/...@v1`) and local paths
// (`./...`) are intentionally exempt: `v1` is this repo's own release channel.

const ROOT = new URL('..', import.meta.url).pathname;

function* yamlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* yamlFiles(path);
    else if (/\.ya?ml$/.test(name)) yield path;
  }
}

const USES = /^\s*(?:-\s+)?uses:\s*([^\s#]+)/;

test('third-party actions are pinned to a full commit SHA', () => {
  const offenders = [];
  for (const dir of ['.github/workflows', 'actions']) {
    for (const file of yamlFiles(join(ROOT, dir))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const m = USES.exec(line);
        if (!m) return;
        const ref = m[1];
        if (ref.startsWith('./') || ref.startsWith('camunda/sdk-infra/')) return;
        if (!/@[0-9a-f]{40}$/.test(ref)) offenders.push(`${file.slice(ROOT.length)}:${i + 1} ${ref}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `unpinned actions:\n${offenders.join('\n')}`);
});

test('the Copilot CLI default version is pinned', () => {
  for (const file of ['sdk-agent-pr-followup.yml', 'sdk-agent-example-coverage.yml']) {
    const text = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
    assert.doesNotMatch(text, /COPILOT_CLI_VERSION \|\| 'latest'/, `${file} defaults the Copilot CLI to latest`);
  }
});
