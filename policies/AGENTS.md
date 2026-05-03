# AGENTS.md — Canonical contributor guidelines for Camunda SDK repos

> This is the shared source of truth for contributor policies across all
> Camunda SDK repositories. Individual SDK repos delegate to this file
> and extend it with repo-specific instructions.

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

## Pre-push checklist

Before pushing any commits, always run a full build. If the build modifies any files (e.g., generated code drift, README snippet drift), commit those changes before pushing.
