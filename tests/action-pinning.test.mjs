import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every third-party `uses:` must name a full commit SHA, never a mutable tag.
// References to this repo itself (`camunda/sdk-infra/...@v1`) and local paths
// (`./...`) are intentionally exempt: `v1` is this repo's own release channel.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function* yamlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* yamlFiles(path);
    else if (/\.ya?ml$/.test(name)) yield path;
  }
}

const USES = /^\s*(?:-\s+)?uses:\s*([^\s#]+)(.*)$/;

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
        // A major-only comment (`# v6`) does not say which release the SHA is.
        else if (!/^\s*#\s*v\d+\.\d+\.\d+\s*$/.test(m[2])) {
          offenders.push(`${file.slice(ROOT.length)}:${i + 1} ${ref} needs an exact version comment, e.g. # v1.2.3`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [], `unpinned actions:\n${offenders.join('\n')}`);
});

test('packages run with npx name an exact version', () => {
  const offenders = [];
  let seen = 0;
  for (const dir of ['.github/workflows', 'actions']) {
    for (const file of yamlFiles(join(ROOT, dir))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // `npx --yes` installs whatever the registry serves; a bare `npx` runs the local install.
        const m = /npx\s+(?:--yes|-y)\s+(\S+)/.exec(line);
        if (!m) return;
        seen += 1;
        if (!/^(@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/.test(m[1])) offenders.push(`${file.slice(ROOT.length)}:${i + 1} ${m[1]}`);
      });
    }
  }
  assert.ok(seen > 0, 'expected to find npx --yes invocations');
  assert.deepEqual(offenders, [], `npx packages without an exact version:\n${offenders.join('\n')}`);
});

test('the Copilot CLI default version is an exact version', () => {
  for (const file of ['sdk-agent-pr-followup.yml', 'sdk-agent-example-coverage.yml']) {
    const text = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
    // A range (`1.x`, `^1.0.108`) moves just like `latest`.
    assert.match(
      text,
      /COPILOT_CLI_VERSION: \$\{\{ vars\.COPILOT_CLI_VERSION \|\| '\d+\.\d+\.\d+' \}\}/,
      `${file} must default the Copilot CLI to an exact x.y.z version`,
    );
  }
});
