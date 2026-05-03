# sdk-infra

Shared infrastructure for Camunda SDK repositories. This repo provides reusable GitHub Actions workflows, composite actions, CLI tools, and shared configuration to eliminate duplication across SDK repos.

## What's included

| Directory | Purpose |
|-----------|---------|
| `.github/workflows/` | Reusable CI workflows (spec bundling, commitlint, integration testing) |
| `actions/` | Composite GitHub Actions (start Camunda stack, sync snippets, check coverage) |
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

### 6. Shared configs

```js
// commitlint.config.cjs
module.exports = require('@camunda/sdk-infra/configs/commitlint.config.base.cjs');

// release.config.cjs
const base = require('@camunda/sdk-infra/configs/release.config.base.cjs');
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

This repo uses tags (`v1`, `v1.1.0`, etc.) to version reusable workflows and actions. SDK repos pin to a major version tag (e.g., `@v1`) for stability.

Breaking changes increment the major version. Additive changes (new inputs, new actions) are backwards-compatible within a major version.

## Language-specific notes

### Python SDK

- **Release config**: Python uses `python-semantic-release` (configured in `pyproject.toml`), not Node.js `semantic-release`. The shared `release.config.base.cjs` does **not** apply to Python.
- **Docker stack**: Python only uses the lightweight (single-service) Docker stack. The `stack: full` option is not applicable.

### TypeScript/JS SDK

- **Snippet files**: The JS SDK stores import-only snippets in `.txt` files (e.g., `readme-imports.txt`). The unified sync script includes `.txt` in the TypeScript file extensions.
- **Multi-source markers**: Composite regions spanning multiple source files use comma-separated paths in the snippet marker (e.g., `examples/readme-imports.txt,examples/readme.ts`).

### C# SDK

- **Additional CI checks**: The C# SDK has a `check-overwrite-completeness.js` guard that is C#-specific and not included in shared infra.
