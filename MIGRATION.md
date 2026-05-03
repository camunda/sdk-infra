# Migration Guide

How to adopt sdk-infra in an existing SDK repo. Each step is independent — adopt incrementally.

## Phase 1: Reusable workflows (CI dedup)

### 1.1 Spec bundling

Replace your repo's spec bundling steps with the reusable workflow.

**Before** (in each SDK's `ci.yml`):
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version: '22'

- name: Fetch & Bundle spec
  run: bash scripts/bundle-spec.sh
```

**After:**
```yaml
jobs:
  bundle:
    uses: camunda/sdk-infra/.github/workflows/sdk-bundle-spec.yml@v1
    with:
      spec-ref: stable/8.9

  build:
    needs: bundle
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: bundled-spec
          path: external-spec/bundled/
      - run: <your-generate-command>
```

You can keep `scripts/bundle-spec.sh` for local dev, or delete it and use:
```bash
npx camunda-schema-bundler --ref stable/8.9 --deref-path-local \
  --output-spec external-spec/bundled/rest-api.bundle.json \
  --output-metadata external-spec/bundled/spec-metadata.json
```

### 1.2 Commitlint

**Before:**
```yaml
commitlint:
  steps:
    - uses: actions/checkout@v6
      with: { fetch-depth: 0 }
    - uses: actions/setup-node@v6
      with: { node-version: '22' }
    - run: npm ci
    - run: npx commitlint --from ${{ github.event.pull_request.base.sha }} --to ${{ github.event.pull_request.head.sha }} --verbose
```

**After:**
```yaml
commitlint:
  if: github.event_name == 'pull_request'
  uses: camunda/sdk-infra/.github/workflows/sdk-commitlint.yml@v1
```

### 1.3 Spec ref guard

**Before** (duplicated bash in each CI):
```yaml
- name: Validate SPEC_REF override
  run: |
    # 15 lines of bash...
```

**After:**
```yaml
guard:
  uses: camunda/sdk-infra/.github/workflows/sdk-spec-ref-guard.yml@v1
  with:
    spec-ref: ${{ env.SPEC_REF }}
    default-ref: stable/8.9
    ack: ${{ vars.SPEC_REF_OVERRIDE_ACK }}
    expires: ${{ vars.SPEC_REF_OVERRIDE_EXPIRES }}
```

## Phase 2: Composite actions (Docker, snippets, coverage)

### 2.1 Docker stack

**Before:**
```yaml
- name: Start Integration Stack
  working-directory: docker
  run: docker compose -f docker-compose-full.yaml up -d

- name: Wait for Services Healthy
  run: |
    attempts=0; max_attempts=60
    while [ $attempts -lt $max_attempts ]; do
      code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9600/actuator/health/status || true)
      [ "$code" = "200" ] && break
      attempts=$((attempts+1)); sleep 5
    done
```

**After:**
```yaml
- uses: camunda/sdk-infra/actions/start-camunda@v1
  with:
    stack: full
    version: 8.9.0

# ... run tests ...

- uses: camunda/sdk-infra/actions/stop-camunda@v1
  if: always()
  with:
    stack: full
```

You can optionally delete your repo's `docker/` directory entirely, or keep it for local dev.

### 2.2 README snippet sync

**Before:**
```yaml
- run: python3 scripts/sync-readme-snippets.py --check
```

**After:**
```yaml
- uses: camunda/sdk-infra/actions/sync-readme-snippets@v1
  with:
    lang: python    # or: csharp, typescript
    check: true
```

For local dev, run the unified script directly:
```bash
python3 path/to/sdk-infra/scripts/sync-readme-snippets.py --lang python --check
```

### 2.3 Example coverage

**Before:**
```yaml
- run: python scripts/check_example_coverage.py
```

**After:**
```yaml
- uses: camunda/sdk-infra/actions/check-example-coverage@v1
  with:
    key-style: snake_case    # python uses snake_case keys
```

## Phase 3: Shared configs (optional)

### 3.1 commitlint config

**Before** (`commitlint.config.cjs`):
```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'never', ['pascal-case']],
    'subject-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 5],
  },
};
```

**After:**
```js
module.exports = require('@camunda/sdk-infra/configs/commitlint.config.base.cjs');
```

Or with overrides:
```js
const base = require('@camunda/sdk-infra/configs/commitlint.config.base.cjs');
module.exports = {
  ...base,
  rules: {
    ...base.rules,
    'body-max-line-length': [2, 'always', 500],
  },
};
```

### 3.2 release config

**Before** (100+ lines of duplicated branch logic):
```js
function currentBranchName() { ... }
function stableMajorFromBranch() { ... }
// ... 60 lines of shared logic ...
module.exports = { branches: ..., plugins: [...] };
```

**After:**
```js
const base = require('@camunda/sdk-infra/configs/release.config.base.cjs');
module.exports = {
  ...base,
  plugins: [
    ...base.plugins,
    ['@semantic-release/npm', { npmPublish: true }],
    ['@semantic-release/git', { assets: ['CHANGELOG.md', 'package.json'] }],
    '@semantic-release/github',
  ],
};
```

## Phase 4: AGENTS.md delegation

Update your repo's AGENTS.md to delegate to the shared version:

```markdown
# AGENTS.md

> **Note:** This file delegates to a shared AGENTS.md. Read and apply it first.

**URL:**
https://raw.githubusercontent.com/camunda/sdk-infra/refs/heads/main/policies/AGENTS.md

## Repo-specific instructions

... (keep your existing repo-specific section)
```

## What to delete from SDK repos after migration

| File | Delete when... |
|------|----------------|
| `scripts/bundle-spec.sh` | Using the reusable workflow in CI (keep for local dev if needed) |
| `scripts/sync-readme-snippets.py` | Using the composite action |
| `scripts/check-example-coverage.js` | Using the composite action |
| `docker/docker-compose*.yaml` | Using the start-camunda action (keep for local dev if needed) |
| Commitlint config body | Replaced with `require(...)` import |
| Release config branch logic | Replaced with base config import |
| Spec ref guard bash | Replaced with reusable workflow |

## Known SDK quirks

These are SDK-specific differences that the shared infra already handles, documented here for awareness:

### Python SDK

1. **Release tooling**: Uses `python-semantic-release` (configured in `pyproject.toml`), not Node.js `semantic-release`. The shared `release.config.base.cjs` does **not** apply to Python — skip Phase 3.2.
3. **No full Docker stack**: Only uses the lightweight single-service stack. Use `stack: simple` (default) when adopting `start-camunda`.
3. **Operation map key style**: Uses `snake_case` keys. Pass `--key-style snake_case` (or `key-style: snake_case` in the action).

### TypeScript/JS SDK

1. **`.txt` snippet files**: Stores import-only snippets in `.txt` files (e.g., `readme-imports.txt`). The unified snippet sync includes `.txt` in TypeScript file scanning.
2. **Multi-source markers**: Composite regions spanning multiple files use comma-separated source paths in the snippet marker.
3. **Region name characters**: Allows dots and hyphens in region names (e.g., `my-region.1`). The unified regex supports `[\w.-]+`.

### C# SDK

1. **Extra CI check**: Has `check-overwrite-completeness.js` (validates hand-written partial class does not conflict with generated code). This is C#-specific and stays in the C# repo.
2. **Region tag format**: Uses XML-style tags (`// <Region>` / `// </Region>`) — distinct from Python/JS comment-style tags. Handled by the `csharp` region pattern.
