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
    version: 8.10.0

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
    lang: python    # or: csharp, typescript, java, go
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

## Phase 5: Backport with regeneration

1. Add the caller, `.github/backport.yml` and, if the toolchain needs more than `actions/setup-sdk-toolchain` provides (e.g. Java for openapi-generator), `.github/actions/codegen-setup`:

   ```yaml
   # .github/workflows/backport.yml
   name: Backport
   on:
     pull_request:
       types: [closed, labeled]
     issue_comment:
       types: [created]
   permissions: {}
   jobs:
     backport:
       # The same gate as sdk-backport.yml's own, here so that concurrency (below) only
       # admits backport events: at workflow level, an unrelated comment or label would
       # replace a pending backport run in the group, and the requested target be lost.
       if: >-
         (
           github.event_name != 'issue_comment' &&
           github.event.pull_request.merged &&
           (github.event.action == 'closed' || startsWith(github.event.label.name, 'backport '))
         ) || (
           github.event_name == 'issue_comment' &&
           github.event.issue.pull_request &&
           github.event.comment.user.id != 290741040 &&
           contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association) &&
           startsWith(github.event.comment.body, '/backport')
         )
       concurrency:
         group: backport-${{ github.event.pull_request.number || github.event.issue.number }}
         cancel-in-progress: false
       permissions:
         contents: read
         id-token: write        # Vault JWT for the App key
         pull-requests: write  # failure comments when the App token is unavailable
       uses: camunda/sdk-infra/.github/workflows/sdk-backport.yml@v1
       secrets:
         VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
         VAULT_JWT_PATH: ${{ secrets.VAULT_JWT_PATH }}
         VAULT_JWT_ROLE: ${{ secrets.VAULT_JWT_ROLE }}
         VAULT_JWT_AUDIENCE: ${{ secrets.VAULT_JWT_AUDIENCE }}
   ```

   ```yaml
   # .github/backport.yml (commit it to main AND to every stable/N it should apply to)
   language: go                 # optional: runs actions/setup-sdk-toolchain
   generated-paths:             # restored from the target branch, then regenerated
     - external-spec
     - client
     - pb
     - facade_generated.go
   # Must regenerate from the committed spec, not refetch it. Compile the tests too,
   # so a backport that breaks only test files fails here rather than in CI.
   regenerate: ./scripts/generate.sh && go vet ./...
   # post-cherry-pick:          # optional: adapt hand-written code to the target branch (below)
   # do-not-backport:           # optional, e.g. C# stable/9 whose generator diverged
   #   - paths: [generator/**]
   #     from: [main]
   #     reason: the stable/9 generator diverged from main
   ```

   ```yaml
   # .github/actions/codegen-setup/action.yml (optional: setup the toolchain action lacks)
   name: Codegen setup
   runs:
     using: composite
     steps:
       - uses: actions/setup-java@<sha> # vX.Y.Z
         with: { distribution: temurin, java-version: '21' }
   ```


   If backports need a mechanical edit to hand-written code on every stable line (Go: the module path's major version), add a `post-cherry-pick` command; see the README's backport section for the Go one.

2. Commit `.github/backport.yml` (and `codegen-setup`) to **every live `stable/N`** as well as `main`: they are read from the target branch. Check that `regenerate` works offline from the committed spec on each line.
3. Create a `backport stable/N` label for each live line.
4. Make sure the Vault JWT role accepts `pull_request` and `issue_comment` runs of the repo, like the other App-token workflows.
5. Delete any repo-local backport workflow (e.g. a copy of korthout/backport-action's example).

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
