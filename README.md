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
| `templates/` | Canonical issue forms for SDK repos |

## SDK repo families

- **Orchestration Cluster API SDKs**, `orchestration-cluster-api-<lang>`: generated from the
  OpenAPI spec in `camunda/camunda`. The SDK major tracks the Camunda server minor (8.10 → 10.x),
  with `stable/N` lines.
- **Console API clients**, `console-api-<lang>`: generated from the SaaS Console (Administration)
  API spec published at `console.cloud.camunda.io`. Versioned independently of Camunda releases.
  [`console-api-js`](https://github.com/camunda/console-api-js) is the reference implementation.

These parts are built around the Orchestration Cluster and do not apply to the Console
API clients: spec bundling, the spec-ref guard, operation coverage and the agent workflows
(sections 1, 5 and 6 below, `sdk-spec-ref-guard.yml`, `sdk-detect-new-ops.yml`), and the
integration-test stack (section 3, `docker/`), which runs an Orchestration Cluster, not the SaaS
Console. The Console API clients reuse the README snippet sync, commitlint, issue labelling, the
shared configs, `sdk-breaking-change-guard.yml` and `sdk-slack-notify.yml`.

The shared release config gives `main` an alpha prerelease role and needs a `stable/N` branch
named by `CAMUNDA_SDK_CURRENT_STABLE_MAJOR` as the release branch. Until both exist,
semantic-release fails on `main` with `ERELEASEBRANCHES`.

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
          version: 8.10.0
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
— a `/agent fix` comment, a failing CI run, or a review from another bot. The bot-review
path runs on an hourly `schedule` rather than on `pull_request_review`, because GitHub
parks any run the `Copilot` actor triggers behind manual approval.

`sdk-agent-auto-merge.yml` queues an agent pull request for GitHub's auto-merge once its
threads are resolved, no changes are requested and its diff stays inside `allowed-paths`.
Rulesets on these repos require no approvals, so by default a human never has to look at
what merges. Set `require-human-approval: true` to also require an approval, on the
pull request's current head commit, from a person with write access (bot approvals,
the Copilot reviewer included, never count; a later push makes the approval stale). The
input is optional and defaults to `false`.

Text that reaches the agent from outside (issue bodies, comments, bot reviews, CI logs)
is passed between per-run nonce markers as data to be ignored as instructions. A small
scan, `.github/scripts/flag-injection.sh`, additionally warns the agent when that text
looks like instructions aimed at it. That is a mitigation, easy to evade: what limits an
injection that gets through is that the agent job holds no credentials.

Declare any tracked file the verify commands legitimately regenerate (a lockfile, a
recorded fixture) in `verify-artifacts`; anything they touch outside that allow-list
fails the run rather than being swept into the commit.

In the SDKs that bundle the spec fresh on every CI run — js, python and csharp — a new
upstream operation fails the coverage check on every open pull request at once, none of
which caused it. `sdk-coverage-gap-dispatch.yml` reacts to that by dispatching the
detector above, so the gap is fixed once against `main`, and leaves a single comment
explaining the red check rather than pushing a commit onto someone else's branch.

### 7. Issue labelling (reusable workflow + issue forms)

Labels issues from the issue form and from `Type:` / `Found-by:` / `Affects:` / `Severity:` lines in the body, so issues opened by agents over the API are labelled the same way as ones from the browser. See [policies/AGENTS.md](policies/AGENTS.md#opening-issues) for the conventions. Copy [templates/ISSUE_TEMPLATE/](templates/ISSUE_TEMPLATE/) to `.github/ISSUE_TEMPLATE/` (GitHub reads forms only from the repo itself), and add:

```yaml
# .github/workflows/issue-labels.yml
on:
  issues:
    types: [opened, edited, reopened, labeled, unlabeled]
permissions:
  issues: write
jobs:
  label:
    uses: camunda/sdk-infra/.github/workflows/sdk-issue-labels.yml@v1
```

### 8. Shared configs

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
