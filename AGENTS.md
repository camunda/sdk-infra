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
- [`orchestration-cluster-api-go`](https://github.com/camunda/orchestration-cluster-api-go) — Go SDK
- [`orchestration-cluster-api-rust`](https://github.com/camunda/orchestration-cluster-api-rust) — Rust SDK
- [`c8ctl`](https://github.com/camunda/c8ctl) — CLI (transitive, via JS SDK)

**Path map:**

| Path | Ownership and intent |
| --- | --- |
| `configs/` | Shared base configs (commitlint, semantic-release) — published to npm |
| `scripts/` | Unified CLI tools (snippet sync, example coverage, spec bundling) — published to npm |
| `schema/` | JSON schemas (e.g. `operation-map.schema.json`) — published to npm |
| `docker/` | Shared Docker Compose files for integration testing — published to npm |
| `policies/` | Canonical contributor guidelines (`AGENTS.md`) — published to npm |
| `actions/` | Composite GitHub Actions (start-camunda, sync-readme-snippets, check-example-coverage, setup-sdk-toolchain) — **not** published to npm |
| `.github/workflows/` | Reusable CI workflows (spec bundling, commitlint, spec-ref guard, detect new ops, agent example coverage) — consumed via `uses:` |

| `MIGRATION.md` | Step-by-step guide for adopting sdk-infra in existing SDK repos |

### What gets published where

This repo has **two distribution channels**:

1. **npm package** (`@camunda8/sdk-infra`): `configs/`, `scripts/`, `schema/`, `docker/`, `policies/`. Controlled by the `files` array in `package.json`. The `.npmignore` excludes `actions/`, `.github/`, and build artifacts.
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
| `sdk-breaking-change-guard.yml` | Fail PR CI when commits contain `BREAKING CHANGE:` notes in body/footer that would trigger a major version bump; bypassed by the `breaking-change-approved` label |
| `sdk-spec-ref-guard.yml` | Validate `SPEC_REF` overrides with expiry |
| `sdk-detect-new-ops.yml` | Detect operations missing SDK example coverage; opens per-SDK issues and a cross-linked summary (requires `SDK_ISSUE_TOKEN` secret for cross-repo issues) |
| `scheduled-detect-new-ops.yml` | Scheduled daily check for SDK coverage gaps with cross-repo issue creation. A thin caller: it bundles the spec, then delegates to `sdk-detect-new-ops.yml` |
| `sdk-agent-example-coverage.yml` | Resolve a `new-operations` coverage issue by running the Copilot CLI and opening a PR. Callers supply `language`, `issue-number` and `verify-commands` |
| `sdk-agent-pr-followup.yml` | React to feedback on an agent-authored PR (`/agent fix` comment, failing CI, bot review) by running the Copilot CLI on the same branch |
| `sdk-slack-notify.yml` | Send a Slack notification when a release/publish workflow fails (requires `SLACK_SDK_ALERTS` repo secret) |
| `sdk-slack-community-notify.yml` | Notify Slack about community issues/PRs and dependency-bot PRs. With `slack-bot-token` + `slack-channel-id` it posts via `chat.postMessage`, records the message reference on the PR, and adds a `:white_check_mark:` reaction when that PR is merged; falls back to the incoming webhook (no reaction) when no bot token is set. Callers must grant `issues: write` and `pull-requests: write` |

#### Composite actions

| Action | Purpose |
|---|---|
| `actions/start-camunda/` | Start Docker-based Camunda stack for integration tests |
| `actions/stop-camunda/` | Stop and clean up Docker stack |
| `actions/sync-readme-snippets/` | Sync README code blocks from source-of-truth example files |
| `actions/check-example-coverage/` | Verify operation-map coverage against OpenAPI spec |
| `actions/setup-sdk-toolchain/` | Install the language toolchain (and project dependencies) for an SDK repo, given `language: js\|python\|csharp\|go\|rust` |

#### The agent workflows

`sdk-agent-example-coverage.yml` and `sdk-agent-pr-followup.yml` are the shared
implementation behind each SDK repo's `.github/workflows/agent-*.yml`. Those callers
are deliberately thin — they own only the triggers, the job permissions, the language,
and the `verify-commands` that define "verified" for that repo.

Three design points are load-bearing and should not be undone casually:

- **Ordering.** The run is `agent → inspect → verify → reconcile → push`. Inspecting the
  working tree *before* verification is the only moment at which a dirty tree
  unambiguously means the agent left work uncommitted; running verify first conflates
  that with a verify command regenerating a lockfile or a recorded fixture.
- **`verify-artifacts`.** Files the verify commands are allowed to regenerate are
  declared as globs. Anything they touch outside that allow-list fails the run rather
  than being swept into the commit.
- **`sdk-infra-ref`.** `uses:` cannot take an expression for its ref, so a branch build
  of a reusable workflow would still load `@v1` composite actions. The workflows instead
  check `camunda/sdk-infra` out at `inputs.sdk-infra-ref` into `.sdk-infra/` and use it
  locally. Set `sdk-infra-ref` in a caller to test a branch end to end. The checkout is
  added to `.git/info/exclude` so it does not register as an untracked file.

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

# Lint the workflows (schema + embedded bash)
actionlint
```

Tests live in `tests/` and use `node:test` (zero extra dependencies). They cover the release config helper functions and verify the branch array output under every branch scenario (main, current stable, older stable, missing env var). The semantic-release invariant (≥1 plain release branch) is asserted for all scenarios.

Full integration validation still happens in downstream SDK repos via their CI pipelines.

#### Workflow linting

Most of this repo is embedded bash inside reusable workflows that five SDK repos depend on, so the workflows are gated by [actionlint](https://github.com/rhysd/actionlint) in `ci.yml` (job `lint-workflows`). actionlint checks the workflow schema, the `${{ }}` expression syntax, and — via bundled [shellcheck](https://www.shellcheck.net/) — every `run:` block.

- **shellcheck must be installed** alongside actionlint. Without it, actionlint silently skips the shell scripts and the gate degrades to a schema-only check. CI asserts `shellcheck --version` for exactly this reason.
- **Composite actions under `actions/` are not linted.** actionlint only understands workflow files, so `run:` blocks in `actions/*/action.yml` go unchecked. Review those by hand.
- **`.github/actionlint.yaml`** holds the ignore list. It currently suppresses one false positive: actionlint's permission-scope list predates `copilot-requests`.
- Both the CI job and local runs use the same pinned release (`1.7.12`, SHA256-verified on download), so local results match CI.


### Versioning

This repo uses two versioning schemes:

- **npm package**: Automated via [semantic-release](https://github.com/semantic-release/semantic-release) on the `main` branch. The version in `package.json` is `0.0.0-semantic-release` (sentinel — never edit manually).
- **GitHub refs**: The moving major tag `v1` only. SDK repos pin to it (`@v1`). Once a change is on `main`, move the tag forward:

  ```bash
  git tag -f v1 origin/main && git push -f origin refs/tags/v1
  ```

  A breaking change to a workflow's or action's interface gets a new major tag (`v2`), and consumers are migrated deliberately.

> [!IMPORTANT]
> **Never hand-create a `vX.Y.Z` tag in this repo.** That namespace belongs to semantic-release, which derives the next npm version from the highest semver tag reachable from `main`. A manual `v1.10.0` makes it believe 1.10.0 already shipped, so it skips to 1.11.0 and npm silently loses a version. The two channels share one tag namespace, so the only safe manual tag is the `v1` major pointer.

#### If a release fails after the tag is pushed

semantic-release pushes the tag *before* it publishes, so a failure in between (for example a transient `remote: fatal error in commit_refs` when pushing its git notes) leaves a tag with no npm release behind it. Re-running the workflow will **not** recover it: the tag is now reachable from `main` with no commits after it, so semantic-release correctly reports "no new release" and exits green having published nothing.

To recover, delete the orphaned tag and re-run:

```bash
git push origin :refs/tags/vX.Y.Z   # remote
git tag -d vX.Y.Z                   # local
gh run rerun <release-run-id>
```

Tags and npm are in sync when the highest `vX.Y.Z` tag, the highest `refs/notes/semantic-release-vX.Y.Z` ref, and `npm view @camunda8/sdk-infra version` all agree.

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
