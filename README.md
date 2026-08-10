# sdk-infra

Shared infrastructure for Camunda SDK repositories. This repo provides reusable GitHub Actions workflows, composite actions, CLI tools, and shared configuration to eliminate duplication across SDK repos.

## What's included

| Directory | Purpose |
|-----------|---------|
| `.github/workflows/` | Reusable CI workflows (spec bundling, commitlint, integration testing, agent example coverage) |
| `actions/` | Composite GitHub Actions (start Camunda stack, sync snippets, check coverage, set up toolchain) |
| `docker/` | Shared Docker Compose files for integration testing |
| `scripts/` | Unified CLI tools (snippet sync, example coverage check, operation detection) |
| `configs/` | Shared commitlint and semantic-release base configurations |
| `schema/` | JSON schema for `operation-map.json` validation |
| `policies/` | Canonical contributor guidelines (AGENTS.md) |

## Quick start for SDK repos

### 1. Spec bundling (reusable workflow)

```yaml
# .github/workflows/ci.yml
jobs:
  bundle:
    uses: camunda/sdk-infra/.github/workflows/sdk-bundle-spec.yml@v1
    with:
      spec-ref: stable/8.9
```

### 2. Commitlint (reusable workflow)

```yaml
  commitlint:
    uses: camunda/sdk-infra/.github/workflows/sdk-commitlint.yml@v1
```

### 3. Start Camunda for integration tests (composite action)

```yaml
  integration:
    steps:
      - uses: camunda/sdk-infra/actions/start-camunda@v1
        with:
          stack: full
          version: 8.9.0
```

### 4. Sync README snippets (composite action)

```yaml
  snippets:
    steps:
      - uses: camunda/sdk-infra/actions/sync-readme-snippets@v1
        with:
          lang: python
          check: true
```

### 5. Check example coverage (composite action)

```yaml
  coverage:
    steps:
      - uses: camunda/sdk-infra/actions/check-example-coverage@v1
        with:
          operation-map: examples/operation-map.json
```

### 6. Agent example coverage (reusable workflows)

When the daily coverage check files a "Missing example coverage" issue, these run the
Copilot CLI against the repo and open a pull request with the examples. The caller owns
only the triggers, the permissions, and the commands that define "verified" here.

```yaml
# .github/workflows/agent-example-coverage.yml
on:
  issues:
    types: [labeled]

permissions: {}

jobs:
  implement:
    if: github.event.label.name == 'new-operations'
    permissions:
      contents: read
      id-token: write
      copilot-requests: write
      issues: write
    uses: camunda/sdk-infra/.github/workflows/sdk-agent-example-coverage.yml@v1
    secrets:
      VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
      VAULT_JWT_PATH: ${{ secrets.VAULT_JWT_PATH }}
      VAULT_JWT_ROLE: ${{ secrets.VAULT_JWT_ROLE }}
      VAULT_JWT_AUDIENCE: ${{ secrets.VAULT_JWT_AUDIENCE }}
    with:
      language: go
      issue-number: ${{ github.event.issue.number }}
      verify-commands: |
        make check
```

A companion `sdk-agent-pr-followup.yml` reacts to feedback on the resulting pull request
— a `/agent fix` comment, a failing CI run, or a review from another bot.

Declare any tracked file the verify commands legitimately regenerate (a lockfile, a
recorded fixture) in `verify-artifacts`; anything they touch outside that allow-list
fails the run rather than being swept into the commit.

### 7. Shared configs

```js
// commitlint.config.cjs
module.exports = require('@camunda8/sdk-infra/configs/commitlint.config.base.cjs');

// release.config.cjs
const base = require('@camunda8/sdk-infra/configs/release.config.base.cjs');
module.exports = { ...base, plugins: [...base.plugins, /* language-specific */] };
```

## Local development tools

The scripts in `scripts/` can be run directly with Python 3.10+:

```bash
# Sync README snippets
python3 scripts/sync-readme-snippets.py --lang csharp --readme ../my-sdk/README.md --examples-dir ../my-sdk/docs/examples --check

# Check example coverage
python3 scripts/check-example-coverage.py --spec ../my-sdk/external-spec/bundled/rest-api.bundle.json --map ../my-sdk/examples/operation-map.json
```

## Versioning

The two distribution channels are versioned separately.

- **npm package** (`@camunda8/sdk-infra`) — released by semantic-release from `main`. The
  version in `package.json` is a sentinel and is never edited by hand.
- **Reusable workflows and composite actions** — the moving major tag `v1` only. SDK repos
  pin to it (`@v1`), and the `Release` workflow moves the tag forward on every push to
  `main`. A breaking change to a workflow's or action's interface gets a new major tag
  (`v2`) and consumers are migrated deliberately; additive changes stay within the current
  major.

The two channels share one tag namespace. `vX.Y.Z` belongs to semantic-release and is never
created by hand — see AGENTS.md for why a manual one silently costs an npm release.

## Language-specific notes

### Python SDK

- **Release config**: Python uses `python-semantic-release` (configured in `pyproject.toml`), not Node.js `semantic-release`. The shared `release.config.base.cjs` does **not** apply to Python.
- **Docker stack**: Python only uses the lightweight (single-service) Docker stack. The `stack: full` option is not applicable.

### TypeScript/JS SDK

- **Snippet files**: The JS SDK stores import-only snippets in `.txt` files (e.g., `readme-imports.txt`). The unified sync script includes `.txt` in the TypeScript file extensions.
- **Multi-source markers**: Composite regions spanning multiple source files use comma-separated paths in the snippet marker (e.g., `examples/readme-imports.txt,examples/readme.ts`).

### C# SDK

- **Additional CI checks**: The C# SDK has a `check-overwrite-completeness.js` guard that is C#-specific and not included in shared infra.
