// Tests for the bundled-compose fallback in the start-camunda / stop-camunda actions.
//
// Both actions let a caller pass `docker-dir`, and otherwise fall back to a path
// derived from `github.action_path`. That fallback is the documented default
// ("Defaults to the action bundled files"), but nothing exercised it: every SDK
// repo that runs integration tests passes `docker-dir` explicitly, so a wrong
// fallback path stayed invisible until a new SDK trusted the documentation and
// got "No such file or directory" from the runner.
//
// These tests resolve the fallback exactly as the runner would - relative to the
// action's own directory, since `github.action_path` is the directory containing
// action.yml - and assert it lands on a directory that really holds the compose
// files the actions go on to select.
//
// Scoped to the defect class rather than the one typo: every action that derives
// a path from `github.action_path` is checked, so the next one cannot point at
// something that does not exist. Notably the two script-running actions already
// use `../../` correctly, which is what makes the Camunda pair's `../` a typo
// rather than a different convention.
//
// Uses node:test (zero dependencies). Run with: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actionsRoot = path.resolve(__dirname, "../actions");

// Matches e.g. `dir=${{ github.action_path }}/../../docker`, capturing the
// relative part that follows the expression.
const ACTION_PATH_FALLBACK =
  /\$\{\{\s*github\.action_path\s*\}\}(\/[^"'\s]*)/g;

/** Every actions/<name>/action.yml in the repo. */
function actionManifests() {
  return readdirSync(actionsRoot)
    .map((name) => ({ name, file: path.join(actionsRoot, name, "action.yml") }))
    .filter((a) => existsSync(a.file));
}

/**
 * Relative paths each action derives from `github.action_path`, resolved
 * against that action's own directory - which is what the runner sets
 * `github.action_path` to.
 */
function fallbackPaths(action) {
  const yaml = readFileSync(action.file, "utf8");
  const actionDir = path.dirname(action.file);
  return [...yaml.matchAll(ACTION_PATH_FALLBACK)].map((m) => ({
    suffix: m[1],
    resolved: path.resolve(actionDir + m[1]),
  }));
}

describe("github.action_path fallbacks", () => {
  it("finds the actions that declare one", () => {
    // Guards the test itself: if the regex stops matching, every assertion
    // below would vacuously pass over an empty list.
    const withFallback = actionManifests().filter(
      (a) => fallbackPaths(a).length > 0,
    );
    const names = withFallback.map((a) => a.name).sort();
    assert.deepEqual(
      names,
      [
        "check-example-coverage",
        "start-camunda",
        "stop-camunda",
        "sync-readme-snippets",
      ],
      "expected exactly these actions to derive a path from github.action_path",
    );
  });

  for (const action of actionManifests()) {
    for (const { suffix, resolved } of fallbackPaths(action)) {
      it(`${action.name}: ${suffix} resolves to something that exists`, () => {
        assert.ok(
          existsSync(resolved),
          `${action.name}/action.yml derives "${suffix}" from github.action_path, which resolves to ${resolved} - that path does not exist, so the documented default cannot work`,
        );
      });
    }
  }

  // The Camunda actions additionally have to land on the compose directory,
  // not merely on something that exists.
  for (const name of ["start-camunda", "stop-camunda"]) {
    const action = actionManifests().find((a) => a.name === name);
    for (const { suffix, resolved } of fallbackPaths(action)) {
      it(`${name}: ${suffix} is the directory holding the compose files`, () => {
        assert.ok(
          statSync(resolved).isDirectory(),
          `${resolved} exists but is not a directory`,
        );
        // The actions pick between these two by the `stack` input, so a
        // fallback directory holding neither is no better than a missing one.
        for (const file of ["docker-compose.yaml", "docker-compose-full.yaml"]) {
          assert.ok(
            existsSync(path.join(resolved, file)),
            `${resolved} does not contain ${file}`,
          );
        }
      });
    }
  }
});
