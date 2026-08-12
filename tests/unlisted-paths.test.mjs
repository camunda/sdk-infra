// Tests for .github/scripts/unlisted-paths.sh
//
// This script is the single implementation shared by both agent workflows to
// decide which changed paths are (or are not) covered by a verify-artifacts
// glob allow-list. A bug here silently breaks the working-tree checks in both
// workflows, so we exercise the matching behavior directly against the real
// script.
//
// Uses node:test (zero dependencies). Run with: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  __dirname,
  "../.github/scripts/unlisted-paths.sh",
);

// bash (invoked here with no shell, so no path translation happens for us)
// needs POSIX-style paths. On POSIX this is a no-op; on Windows it converts
// "C:\foo\bar" to "/c/foo/bar" so this test also runs under the MSYS bash
// shipped with Git for Windows.
function toPosixPath(p) {
  const winMatch = /^([A-Za-z]):(.*)$/.exec(p);
  if (!winMatch) return p;
  const [, drive, rest] = winMatch;
  return `/${drive.toLowerCase()}${rest.replace(/\\/g, "/")}`;
}

/**
 * Runs unlisted-paths.sh with the given newline-separated glob patterns
 * against the given newline-separated input paths, returning the
 * newline-separated list of paths that matched none of the patterns.
 */
function unlistedPaths(patterns, paths) {
  const dir = mkdtempSync(path.join(tmpdir(), "unlisted-paths-test-"));
  try {
    const patternsFile = path.join(dir, "patterns.txt");
    writeFileSync(patternsFile, patterns.join("\n"));
    const output = execFileSync(
      "bash",
      [toPosixPath(scriptPath), toPosixPath(patternsFile)],
      {
        input: paths.join("\n"),
        encoding: "utf8",
      },
    );
    return output.split("\n").filter((line) => line !== "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("unlisted-paths.sh", () => {
  it("returns all paths unchanged when the allow-list is empty", () => {
    const result = unlistedPaths([], ["src/a.js", "docs/readme.md"]);
    assert.deepEqual(result, ["src/a.js", "docs/readme.md"]);
  });

  it("returns nothing when every path matches an allow-list glob", () => {
    const result = unlistedPaths(
      ["dist/*", "docs/*.md"],
      ["dist/bundle.js", "docs/readme.md"],
    );
    assert.deepEqual(result, []);
  });

  it("returns only the paths that match no allow-list glob", () => {
    const result = unlistedPaths(
      ["dist/*"],
      ["dist/bundle.js", "src/a.js", "dist/bundle.js.map"],
    );
    assert.deepEqual(result, ["src/a.js"]);
  });

  it("ignores blank lines in both the patterns file and stdin", () => {
    const result = unlistedPaths(
      ["", "dist/*", ""],
      ["dist/bundle.js", "", "src/a.js"],
    );
    assert.deepEqual(result, ["src/a.js"]);
  });

  it("supports globs matching nested paths within a directory", () => {
    const result = unlistedPaths(
      ["build/**"],
      ["build/sub/dir/file.txt", "src/a.js"],
    );
    assert.deepEqual(result, ["src/a.js"]);
  });

  it("treats patterns as shell case globs, not paths with no special chars", () => {
    const result = unlistedPaths(
      ["exact/match.txt"],
      ["exact/match.txt", "exact/match.txt.bak"],
    );
    assert.deepEqual(result, ["exact/match.txt.bak"]);
  });
});
