// Tests for configs/release.config.base.cjs
//
// The release config has real branching logic that controls releases for every
// downstream SDK. A bug here silently breaks releases across all repos, so we
// exercise every branch scenario and helper function.
//
// Uses node:test (zero dependencies). Run with: node --test tests/

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers: load the config with controlled env vars
// ---------------------------------------------------------------------------

// The config reads env vars and git state at require-time, so we must
// manipulate the environment before each fresh require().
function loadConfig({ GITHUB_REF_NAME, CAMUNDA_SDK_CURRENT_STABLE_MAJOR } = {}) {
  // Save and set env vars
  const saved = {};
  for (const key of ["GITHUB_REF_NAME", "CAMUNDA_SDK_CURRENT_STABLE_MAJOR"]) {
    saved[key] = process.env[key];
  }

  if (GITHUB_REF_NAME !== undefined) {
    process.env.GITHUB_REF_NAME = GITHUB_REF_NAME;
  } else {
    delete process.env.GITHUB_REF_NAME;
  }

  if (CAMUNDA_SDK_CURRENT_STABLE_MAJOR !== undefined) {
    process.env.CAMUNDA_SDK_CURRENT_STABLE_MAJOR =
      CAMUNDA_SDK_CURRENT_STABLE_MAJOR;
  } else {
    delete process.env.CAMUNDA_SDK_CURRENT_STABLE_MAJOR;
  }

  // Bust the require cache so the config re-evaluates with new env vars
  const configPath = require.resolve("../configs/release.config.base.cjs");
  delete require.cache[configPath];

  let config;
  try {
    config = require(configPath);
  } finally {
    // Restore env vars
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe("helper functions", () => {
  let helpers;

  beforeEach(() => {
    const config = loadConfig({ GITHUB_REF_NAME: "main" });
    helpers = config._helpers;
  });

  describe("stableMajorFromBranch", () => {
    it("extracts major from stable/N", () => {
      assert.equal(helpers.stableMajorFromBranch("stable/9"), "9");
      assert.equal(helpers.stableMajorFromBranch("stable/10"), "10");
      assert.equal(helpers.stableMajorFromBranch("stable/123"), "123");
    });

    it("returns null for non-stable branches", () => {
      assert.equal(helpers.stableMajorFromBranch("main"), null);
      assert.equal(helpers.stableMajorFromBranch("feature/foo"), null);
      assert.equal(helpers.stableMajorFromBranch("stable/"), null);
      assert.equal(helpers.stableMajorFromBranch("stable/abc"), null);
      assert.equal(helpers.stableMajorFromBranch(""), null);
    });
  });

  describe("stableDistTagForMajor", () => {
    it("appends -stable suffix", () => {
      assert.equal(helpers.stableDistTagForMajor("9"), "9-stable");
      assert.equal(helpers.stableDistTagForMajor("10"), "10-stable");
    });
  });

  describe("envCurrentStableMajor", () => {
    it("reads from CAMUNDA_SDK_CURRENT_STABLE_MAJOR", () => {
      const config = loadConfig({
        GITHUB_REF_NAME: "main",
        CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
      });
      assert.equal(config._helpers.currentStableMajor, "9");
    });

    it("returns null when env var is missing", () => {
      const config = loadConfig({ GITHUB_REF_NAME: "main" });
      assert.equal(config._helpers.currentStableMajor, null);
    });

    it("returns null when env var is empty or non-numeric", () => {
      for (const val of ["", " ", "abc", "9.1"]) {
        const config = loadConfig({
          GITHUB_REF_NAME: "main",
          CAMUNDA_SDK_CURRENT_STABLE_MAJOR: val,
        });
        assert.equal(
          config._helpers.currentStableMajor,
          null,
          `expected null for "${val}"`,
        );
      }
    });
  });

  describe("maintenanceBranchConfig", () => {
    it("produces correct shape", () => {
      const result = helpers.maintenanceBranchConfig("stable/8", "8");
      assert.deepEqual(result, {
        name: "stable/8",
        range: "8.x",
        channel: "8-stable",
      });
    });
  });

  describe("dedupeBranches", () => {
    it("removes duplicates by name", () => {
      const result = helpers.dedupeBranches([
        { name: "main" },
        { name: "main", prerelease: "alpha" },
        { name: "stable/9" },
      ]);
      assert.equal(result.length, 2);
      assert.equal(result[0].name, "main");
      assert.equal(result[1].name, "stable/9");
    });

    it("handles string entries", () => {
      const result = helpers.dedupeBranches(["main", "main", "stable/9"]);
      assert.deepEqual(result, ["main", "stable/9"]);
    });

    it("skips null/undefined entries", () => {
      const result = helpers.dedupeBranches([null, undefined, { name: "main" }]);
      assert.equal(result.length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Branch array scenario tests
// ---------------------------------------------------------------------------

describe("branch array", () => {
  describe("on main with CAMUNDA_SDK_CURRENT_STABLE_MAJOR=9", () => {
    let config;

    beforeEach(() => {
      config = loadConfig({
        GITHUB_REF_NAME: "main",
        CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
      });
    });

    it("main is prerelease (alpha)", () => {
      const main = config.branches.find((b) => b.name === "main");
      assert.ok(main, "main branch must exist");
      assert.equal(main.prerelease, "alpha");
      assert.equal(main.channel, "alpha");
    });

    it("stable/9 is a release branch (no range, no prerelease)", () => {
      const stable = config.branches.find((b) => b.name === "stable/9");
      assert.ok(stable, "stable/9 branch must exist");
      assert.equal(stable.range, undefined, "must not have range on main CI");
      assert.equal(stable.prerelease, undefined);
      assert.equal(stable.channel, "latest");
    });

    it("has exactly 2 branches", () => {
      assert.equal(config.branches.length, 2);
    });
  });

  describe("on stable/9 (current) with CAMUNDA_SDK_CURRENT_STABLE_MAJOR=9", () => {
    let config;

    beforeEach(() => {
      config = loadConfig({
        GITHUB_REF_NAME: "stable/9",
        CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
      });
    });

    it("main is a plain release branch", () => {
      const main = config.branches.find((b) => b.name === "main");
      assert.ok(main, "main branch must exist");
      assert.equal(main.prerelease, undefined);
      assert.equal(main.channel, undefined);
    });

    it("stable/9 is maintenance (range: 9.x)", () => {
      const stable = config.branches.find((b) => b.name === "stable/9");
      assert.ok(stable, "stable/9 branch must exist");
      assert.equal(stable.range, "9.x");
      assert.equal(stable.channel, "latest");
    });

    it("has exactly 2 branches", () => {
      assert.equal(config.branches.length, 2);
    });
  });

  describe("on stable/8 (older) with CAMUNDA_SDK_CURRENT_STABLE_MAJOR=9", () => {
    let config;

    beforeEach(() => {
      config = loadConfig({
        GITHUB_REF_NAME: "stable/8",
        CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
      });
    });

    it("main is a plain release branch", () => {
      const main = config.branches.find((b) => b.name === "main");
      assert.ok(main, "main branch must exist");
      assert.equal(main.prerelease, undefined);
    });

    it("stable/9 (current) is present without range", () => {
      const stable9 = config.branches.find((b) => b.name === "stable/9");
      assert.ok(stable9, "stable/9 branch must exist");
      assert.equal(stable9.range, undefined);
      assert.equal(stable9.channel, "latest");
    });

    it("stable/8 is maintenance (range: 8.x)", () => {
      const stable8 = config.branches.find((b) => b.name === "stable/8");
      assert.ok(stable8, "stable/8 branch must exist");
      assert.equal(stable8.range, "8.x");
      assert.equal(stable8.channel, "8-stable");
    });

    it("has exactly 3 branches", () => {
      assert.equal(config.branches.length, 3);
    });
  });

  describe("on main without CAMUNDA_SDK_CURRENT_STABLE_MAJOR", () => {
    let config;

    beforeEach(() => {
      config = loadConfig({ GITHUB_REF_NAME: "main" });
    });

    it("main is prerelease (alpha)", () => {
      const main = config.branches.find((b) => b.name === "main");
      assert.ok(main);
      assert.equal(main.prerelease, "alpha");
    });

    it("has exactly 1 branch (no stable line configured)", () => {
      assert.equal(config.branches.length, 1);
    });
  });

  describe("semantic-release invariant: at least one release branch", () => {
    // semantic-release requires ≥1 branch with neither `range` nor `prerelease`.
    // Verify this holds for every scenario.

    for (const [label, env] of [
      [
        "main with stable major",
        { GITHUB_REF_NAME: "main", CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9" },
      ],
      [
        "stable/9 current",
        {
          GITHUB_REF_NAME: "stable/9",
          CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
        },
      ],
      [
        "stable/8 older",
        {
          GITHUB_REF_NAME: "stable/8",
          CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
        },
      ],
    ]) {
      it(`${label}: has at least one plain release branch`, () => {
        const config = loadConfig(env);
        const releaseBranches = config.branches.filter(
          (b) => !b.range && !b.prerelease,
        );
        assert.ok(
          releaseBranches.length >= 1,
          `expected ≥1 release branch, got ${releaseBranches.length}: ${JSON.stringify(config.branches)}`,
        );
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Base plugins
// ---------------------------------------------------------------------------

describe("base plugins", () => {
  it("includes commit-analyzer, release-notes-generator, and changelog", () => {
    const config = loadConfig({ GITHUB_REF_NAME: "main" });
    const pluginNames = config.plugins.map((p) =>
      Array.isArray(p) ? p[0] : p,
    );
    assert.ok(pluginNames.includes("@semantic-release/commit-analyzer"));
    assert.ok(pluginNames.includes("@semantic-release/release-notes-generator"));
    assert.ok(pluginNames.includes("@semantic-release/changelog"));
  });

  it("commit-analyzer has expected release rules", () => {
    const config = loadConfig({ GITHUB_REF_NAME: "main" });
    const [, opts] = config.plugins.find(
      (p) => Array.isArray(p) && p[0] === "@semantic-release/commit-analyzer",
    );
    const types = opts.releaseRules.map((r) => r.type).filter(Boolean);
    assert.ok(types.includes("feat"));
    assert.ok(types.includes("fix"));
    assert.ok(types.includes("perf"));
    assert.ok(types.includes("revert"));
  });
});

// ---------------------------------------------------------------------------
// _helpers export
// ---------------------------------------------------------------------------

describe("_helpers export", () => {
  it("exports all expected helper functions and computed values", () => {
    const config = loadConfig({
      GITHUB_REF_NAME: "main",
      CAMUNDA_SDK_CURRENT_STABLE_MAJOR: "9",
    });
    const h = config._helpers;

    // Functions
    assert.equal(typeof h.currentBranchName, "function");
    assert.equal(typeof h.stableMajorFromBranch, "function");
    assert.equal(typeof h.stableDistTagForMajor, "function");
    assert.equal(typeof h.envCurrentStableMajor, "function");
    assert.equal(typeof h.maintenanceBranchConfig, "function");
    assert.equal(typeof h.dedupeBranches, "function");

    // Computed values
    assert.equal(h.branch, "main");
    assert.equal(h.stableMajor, null);
    assert.equal(h.currentStableMajor, "9");
    assert.equal(h.isOnMain, true);
    assert.equal(h.isOnCurrentStable, false);
  });
});
