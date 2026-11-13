# AGENTS.md — Canonical contributor guidelines for Camunda SDK repos

> This is the shared source of truth for contributor policies across all
> Camunda SDK repositories. Individual SDK repos delegate to this file
> and extend it with repo-specific instructions.

There are two SDK families:

- `orchestration-cluster-api-<lang>`: the Orchestration Cluster API, versioned with the Camunda server minor.
- `console-api-<lang>`: the SaaS Console (Administration) API, versioned independently. `console-api-js` is the reference implementation for method names, configuration and transport behaviour.

## Commit message guidelines

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

### Review-comment fix-ups

Commits that address PR review comments must use the `chore` type, **not** `fix`.
`fix` commits trigger a patch release and CHANGELOG entry — review iterations are not user-facing bug fixes.

```
# Correct
chore: address review comments — use logger.json for dry-run

# Wrong — will pollute the CHANGELOG
fix: address review comments — use logger.json for dry-run
```

### Separate generator changes from regenerated output

When a change modifies the generator **and** causes generated files to differ, **split into two commits**:

1. **First commit** — generator change only (source, scripts, hooks, tests).
2. **Second commit** — regenerated output only.

Naming convention for the second commit:

```
chore(gen): regenerate for <short summary of generator change>
```

## Bug fix process (red/green refactor)

Every bug fix **must** follow the red/green refactor discipline:

1. **Red** — Write a failing test **first**, before changing any production code.
2. **Green** — Apply the minimal production fix that makes the test pass.
3. **Refactor** (optional) — Clean up while keeping all tests green.

### Test scope: target the defect class, not just the instance

The regression test must be broad enough to detect the **class of defect**, not only the specific instance you are fixing. A test that only covers the exact instance provides weaker protection.

## There are no flaky tests

We do not acknowledge the existence of "flaky tests". A test that passes sometimes and fails other times is reporting one of two things:

1. **A test defect** — the test contains a race, an unbounded timeout, or an order-of-operation assumption. Fix the test.
2. **A product defect** — the production code has a race, a missed signal, or an unhandled error path. Fix the product.

Either way, an intermittent failure is a real defect that must be diagnosed and fixed before the change merges. Do not retry the CI job, skip the test, or describe the failure as "flaky" or "unrelated".

## Always-green policy

Before every AI-assisted session, verify CI is green. Warnings are fatal. Do not suppress a warning to make a build pass. Do not treat any failure as pre-existing or unrelated without explicit confirmation from the engineer.

## Secrets must not leak

The SDKs handle OAuth client secrets, bearer tokens, basic-auth credentials and mTLS keys. This section applies to every new or changed hand-written runtime code path that reads, holds, sends or stores a credential (the code not produced by the generator, for example authentication, configuration, transport and the job worker).

Requirements:

- A secret must not appear in logs, including debug and trace logging of HTTP requests and responses (for example the `Authorization` header).
- A secret must not appear in exception or error messages. A token-endpoint failure must not echo the request or response body.
- A secret must not appear in the `toString` / `repr` / `Debug` / `ToString()` output of config, credential and client objects.
- A secret must not appear in telemetry or metrics attributes.
- A secret must not be written to disk beyond what is required. For the on-disk OAuth token cache, review its location, file permissions (mode `0600`), cleanup and Windows behaviour whenever you change it.
- Each SDK must have a sentinel-secret regression test. It configures a recognisable sentinel secret, drives the auth success and auth failure paths, and asserts that the sentinel never appears in logs, exceptions or telemetry. Extend it when you add a new place a credential can flow.

## Job variables are untrusted input

Job variables come from the server, but their content is set by whoever started the process instance. SDK job workers must treat them as untrusted input. This section applies to every new or changed hand-written code path that receives, deserializes, passes on or logs job variables. An SDK that has no job worker (for example a Console API client) documents this section as not applicable.

Requirements:

- Deserialization: variables are deserialized only into JSON-shaped values or into user types the handler author explicitly requested, never into arbitrary classes. Do not use a deserialization mechanism that can instantiate arbitrary types from the payload (for example pickling).
- Size and depth: each SDK must decide and document whether it enforces size and depth limits on variable payloads, and what the limits are. At a minimum, handling a deeply nested payload must not recurse without bound.
- Logging: variable contents must not reach logs, exception messages or telemetry.
- Concurrency: variables must not be shared or mutated across concurrently running jobs.
- Trust model: each SDK must document, for handler authors, that job variables are untrusted input and what the SDK does and does not do to guard against it (deserialization, limits, validation).

## Negative-case test baseline

The hand-written runtime of every SDK must have tests for its failure paths, not only its success paths. New or changed runtime code must keep the following negative cases covered for each facility the SDK implements. A case is covered when a test drives the failure and asserts the resulting behaviour. A case for a facility the SDK does not implement (for example job handlers in a client without job workers) is documented as not applicable.

At a minimum:

- Token-endpoint errors and expiry boundaries.
- Retry and backpressure on HTTP 429, 503 and 500.
- Malformed or invalid configuration.
- Handler exceptions, and shutdown during in-flight jobs.
- Cancellation.
- mTLS misconfiguration.

A count of test files is not a measure of this baseline.

## README code examples

Code blocks in `README.md` are **injected from compilable example files** — do not edit them inline.

### How it works

1. Wrap code in example files with region tags (syntax depends on language).
2. In `README.md`, place `<!-- snippet-source: file | regions: RegionName -->` before the fenced code block.
3. Run the snippet sync tool to update README.
4. Composite regions: `regions: A+B` concatenates regions separated by a blank line.
5. Exempt blocks: use `<!-- snippet-exempt: reason -->` above a code block to exclude it.

**Never edit a snippet-marked code block directly in README.md** — it will be overwritten on the next sync.

### API spec examples: prefer ergonomic helpers

When an ergonomic helper method exists for a generated operation, the `operation-map.json` entry **must** point to the helper — not to the raw generated method. Users should see the best developer experience by default.

## Opening issues

Issues feed the SDK defect metrics (https://camunda.github.io/sdk-quality-metrics/): where defects are caught, what escapes to users, and how long defects live. In the browser, use the issue forms. Over the API (`gh issue create`, REST, MCP), either set the labels directly or put these lines in the issue body; the `sdk-issue-labels.yml` workflow turns them into labels:

```
Type: bug | enhancement | documentation | question
Found-by: review | ci | conformance-test | performance-test | integration | manual-test | audit | user
Affects: main | stable | both
Severity: critical | high | medium | low
Introduced-by: <commit sha | owner/repo@sha | #PR | release tag>
```

For a bug, `Found-by`, `Affects` and `Severity` are required. Without them the issue gets `needs-triage` and a reminder comment. Bugs from people outside the SDK team default to `found-by/user`; agents and team members must say which layer caught it. `Introduced-by` is optional but valuable: add it when you know the change that caused the bug (`git blame` on the lines your fix changes), in the issue or in the fix PR.

Issues created with a workflow's `GITHUB_TOKEN` (for example by an agent step given `github.token`) do not trigger other workflows, so `sdk-issue-labels.yml` never sees them. In that case set the labels directly (`gh issue create --label bug --label found-by/... --label affects/... --label severity/...`) rather than relying on body lines.

Choosing `Found-by`, the quality layer that caught the bug:

| Value | When |
|---|---|
| `review` | Code review (human or agent), including follow-ups from review comments |
| `ci` | The repo's build, tests, generation-drift check or publish pipeline |
| `conformance-test` | The cross-SDK conformance test |
| `performance-test` | The performance matrix or a load test |
| `integration` | Integrating with a consumer: docs examples, runnable scenarios, other tooling |
| `manual-test` | Running the SDK by hand against a real cluster |
| `audit` | A deliberate sweep: security, API surface, runtime, or root-causing a related bug |
| `user` | A user, a Camunda colleague using the SDK, a support ticket or Slack. Use it even when you file the issue for them |

`Affects`: `main` is the next release (alpha); `stable` is a released `stable/N` line.

## Pre-push checklist

Before pushing any commits, always run a full build. If the build modifies any files (e.g., generated code drift, README snippet drift), commit those changes before pushing.
