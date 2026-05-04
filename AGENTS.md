# AGENTS.md

> **Note:** This file delegates to a central AGENTS.md. Read and apply it before proceeding.

**URL:**
https://raw.githubusercontent.com/camunda/.github/refs/heads/main/AGENTS.md

Treat the central file's contents as if they were written directly in this file.
Instructions below extend those guidelines and take precedence if there is any conflict.

## Repo-specific instructions

### Role & boundary

This repo (`@camunda8/sdk-infra`) provides shared infrastructure for all Camunda SDK repositories. It publishes an npm package consumed as a devDependency and provides reusable GitHub Actions workflows and composite actions consumed via `uses:` references.

Downstream consumers — changes here affect all of them, so test thoroughly:

- [`orchestration-cluster-api-js`](https://github.com/camunda/orchestration-cluster-api-js) — TypeScript SDK
- [`orchestration-cluster-api-csharp`](https://github.com/camunda/orchestration-cluster-api-csharp) — C# SDK
- [`orchestration-cluster-api-python`](https://github.com/camunda/orchestration-cluster-api-python) — Python SDK
- [`c8ctl`](https://github.com/camunda/c8ctl) — CLI (transitive, via JS SDK)

**Path map:**

| Path | Ownership and intent |
| --- | --- |
| `configs/` | Shared base configs (commitlint, semantic-release) — published to npm |
| `scripts/` | Unified CLI tools (snippet sync, example coverage, spec bundling) — published to npm |
| `schema/` | JSON schemas (e.g. `operation-map.schema.json`) — published to npm |
| `docker/` | Shared Docker Compose files for integration testing — published to npm |
| `policies/` | Canonical contributor guidelines (`AGENTS.md`) — published to npm |
| `actions/` | Composite GitHub Actions (start-camunda, sync-readme-snippets, check-example-coverage) — **not** published to npm |
| `.github/workflows/` | Reusable CI workflows (spec bundling, commitlint, spec-ref guard, detect new ops) — consumed via `uses:` |
| `operations-baseline.json` | Known operations baseline for new-operation detection — published to npm |
| `MIGRATION.md` | Step-by-step guide for adopting sdk-infra in existing SDK repos |

### What gets published where

This repo has **two distribution channels**:

1. **npm package** (`@camunda8/sdk-infra`): `configs/`, `scripts/`, `schema/`, `docker/`, `policies/`, `operations-baseline.json`. Controlled by the `files` array in `package.json`. The `.npmignore` excludes `actions/`, `.github/`, and build artifacts.
2. **GitHub refs** (`camunda/sdk-infra@v1`): reusable workflows in `.github/workflows/` and composite actions in `actions/`. Consumed by downstream repos via `uses:` in their CI.

When adding new content, decide which channel it belongs to. Configs and scripts go to npm. Workflow automation goes to GitHub refs.

### Architecture

```
sdk-infra
├── npm package (configs, scripts, schema, docker, policies)
│   └── consumed via: require('@camunda8/sdk-infra/configs/...')
└── GitHub refs (workflows, actions)
    └── consumed via: uses: camunda/sdk-infra/.github/workflows/...@v1
```

#### Shared configs

- **`configs/release.config.base.cjs`** — Semantic-release base config with the branch-role-swapping model. SDK repos import this base and append language-specific plugins. Exports `_helpers` for SDK-specific configs to reuse computed branch context.
- **`configs/commitlint.config.base.cjs`** — Commitlint base rules (conventional commits, subject length, no PascalCase). SDK repos can import directly or extend with overrides.

#### Branch-role-swapping model

The release config uses a dynamic branch array computed at CI time:

| CI runs on | `main` role | `stable/N` role |
|---|---|---|
| `main` | prerelease (alpha) | release (latest) |
| `stable/N` (current) | plain release branch | maintenance (range: N.x) |
| `stable/N` (older) | plain release branch | maintenance (range: N.x) |

The currently promoted stable major is set via the `CAMUNDA_SDK_CURRENT_STABLE_MAJOR` repo variable in each downstream repo. Published versions are identical across models.

#### Reusable workflows

| Workflow | Purpose |
|---|---|
| `sdk-bundle-spec.yml` | Fetch and bundle upstream OpenAPI spec |
| `sdk-commitlint.yml` | Lint PR commit messages |
| `sdk-spec-ref-guard.yml` | Validate `SPEC_REF` overrides with expiry |
| `sdk-detect-new-ops.yml` | Detect new operations in the OpenAPI spec |
| `scheduled-detect-new-ops.yml` | Scheduled trigger for new-operation detection |

#### Composite actions

| Action | Purpose |
|---|---|
| `actions/start-camunda/` | Start Docker-based Camunda stack for integration tests |
| `actions/stop-camunda/` | Stop and clean up Docker stack |
| `actions/sync-readme-snippets/` | Sync README code blocks from source-of-truth example files |
| `actions/check-example-coverage/` | Verify operation-map coverage against OpenAPI spec |

### Build & test

This repo has no build step. It publishes source files directly.

```bash
# Install devDependencies (for semantic-release dry-run)
npm install

# Run tests (release config helpers + branch array scenarios)
npm test

# Verify configs load without errors
node -e "require('./configs/release.config.base.cjs')"
node -e "require('./configs/commitlint.config.base.cjs')"

# Run scripts locally (Python 3.10+)
python3 scripts/sync-readme-snippets.py --help
python3 scripts/check-example-coverage.py --help
```

Tests live in `tests/` and use `node:test` (zero extra dependencies). They cover the release config helper functions and verify the branch array output under every branch scenario (main, current stable, older stable, missing env var). The semantic-release invariant (≥1 plain release branch) is asserted for all scenarios.

Full integration validation still happens in downstream SDK repos via their CI pipelines.

### Versioning

This repo uses two versioning schemes:

- **npm package**: Automated via [semantic-release](https://github.com/semantic-release/semantic-release) on the `main` branch. The version in `package.json` is `0.0.0-semantic-release` (sentinel — never edit manually).
- **GitHub refs**: Manual tags (`v1`, `v1.1.0`, etc.) for reusable workflows and actions. SDK repos pin to a major version tag (`@v1`). Breaking changes increment the major version.

> **Note:** npm provenance is currently disabled because this is a private repo. Tracked in [#1](https://github.com/camunda/sdk-infra/issues/1) for when the repo goes public.

### Commit message guidelines

We use Conventional Commits (enforced by commitlint in CI).

Format:

```
<type>(optional scope): <subject>

<body>

BREAKING CHANGE: <explanation>
```

Allowed types:

```
feat fix chore docs style refactor test ci build perf
```

Rules:

- Subject length: 5–100 characters.
- Use imperative mood ("add support", not "added support").
- Lowercase subject (except proper nouns). No PascalCase subjects.
- Keep subject concise; body can include details, rationale, links.
- Prefix breaking changes with `BREAKING CHANGE:` in body or footer.

#### Review-comment fix-ups

Commits that address PR review comments must use `chore`, **not** `fix`.
`fix` commits trigger a patch release — review iterations are not user-facing bug fixes.

### Impact assessment

Changes to this repo propagate to all downstream SDKs. Before merging:

1. **Configs** (`configs/`): Verify the change is backwards-compatible or coordinate updates across all SDK repos. Test by temporarily pointing an SDK's `package.json` to the branch (`"@camunda8/sdk-infra": "github:camunda/sdk-infra#my-branch"`).
2. **Workflows** (`.github/workflows/`): Test with `@<branch>` ref in a downstream repo's CI before tagging.
3. **Actions** (`actions/`): Same as workflows — test with `@<branch>` ref first.
4. **Scripts** (`scripts/`): Run the script against each SDK's repo structure to verify output.

### Language-specific notes

- **Python SDK**: Uses `python-semantic-release` (configured in `pyproject.toml`), not Node.js `semantic-release`. The shared `release.config.base.cjs` does **not** apply to Python. Commitlint and scripts do apply.
- **C# SDK**: The `commitlint.config.base.cjs` is extended with `body-max-line-length: [2, 'always', 500]`. Release config appends C#-specific exec plugins for NuGet.
- **JS SDK**: Release config appends `@semantic-release/npm`, `@semantic-release/git`, `@semantic-release/github`.
