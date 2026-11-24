// Tests for .github/scripts/lint-commit-messages.sh
//
// Both agent workflows run this before publishing, while the agent's commits
// can still be reworded. `npm`/`npx` are stubbed on PATH so the tests run
// offline; what is under test is the literal-"\n" check, that a commitlint
// failure fails the script, and that the caller's working tree is untouched.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../.github/scripts/lint-commit-messages.sh");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function stubBin(dir, npmExit, npxExit) {
  mkdirSync(dir, { recursive: true });
  for (const [name, code] of [["npm", npmExit], ["npx", npxExit]]) {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\nexit ${code}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

function run(repo, { npmExit = 0, npxExit = 0 } = {}) {
  const bin = stubBin(path.join(repo, "..", `bin-${npmExit}-${npxExit}`), npmExit, npxExit);
  return spawnSync("bash", [scriptPath, "base", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
}

describe("lint-commit-messages.sh", () => {
  let root;
  let repo;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "lint-commits-"));
    repo = path.join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    git(repo, "commit", "-q", "--allow-empty", "-m", "chore: base");
    git(repo, "tag", "base");
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  it("passes well-formed multi-line messages and leaves the tree clean", () => {
    git(repo, "commit", "-q", "--allow-empty", "-m", "docs: add example", "-m", "Closes #1");
    const res = run(repo);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(git(repo, "status", "--porcelain", "--untracked-files=all"), "");
    assert.equal(git(repo, "worktree", "list").split("\n").length, 1);
  });

  it("fails when commitlint fails", () => {
    const res = run(repo, { npxExit: 1 });
    assert.equal(res.status, 1);
  });

  it("fails when the install fails, even if commitlint would then pass", () => {
    const res = run(repo, { npmExit: 1, npxExit: 0 });
    assert.equal(res.status, 1);
  });

  for (const tail of [
    "Body.\\n\\nRefs #1",
    "Body.\\ncloses #1",
    "Body.\\nFixes #1",
    "Body.\\nresolved #1",
    "Body.\\nCo-authored-by: A <a@example.com>",
  ]) {
    it(`names commits whose message holds a literal \\n (${tail})`, () => {
      git(repo, "commit", "-q", "--allow-empty", "-m", "docs: add example", "-m", tail);
      const res = run(repo);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /literal '\\n'/);
      assert.match(res.stdout, /^ {2}[0-9a-f]+ docs: add example$/m);
      git(repo, "reset", "-q", "--hard", "HEAD~1");
    });
  }

  it("does not flag prose that mentions \\n", () => {
    git(repo, "commit", "-q", "--allow-empty", "-m", "ci: reject literal \\n in messages",
      "-m", 'The agent wrote `-m "...\\n\\n..."`; split on \\n instead.');
    const res = run(repo);
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
