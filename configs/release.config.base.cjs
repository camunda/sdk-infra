// Shared semantic-release base configuration for all Camunda SDK repos.
//
// This provides the branch model and common helper functions. Each SDK repo
// imports this base and appends its language-specific plugins.
//
// Usage:
//   const base = require('@camunda/sdk-infra/configs/release.config.base.cjs');
//   module.exports = {
//     ...base,
//     plugins: [
//       ...base.plugins,
//       ['@semantic-release/npm', { npmPublish: true }],
//       // ... other language-specific plugins
//     ],
//   };

// ---------------------------------------------------------------------------
// Helper functions (exported for SDK-specific configs to reuse)
// ---------------------------------------------------------------------------

function currentBranchName() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function stableMajorFromBranch(branch) {
  const m = /^stable\/(\d+)$/.exec(branch);
  return m ? m[1] : null;
}

function stableDistTagForMajor(major) {
  // npm dist-tags must NOT be a valid SemVer version or range.
  // "9" alone is a valid SemVer range, so append "-stable".
  return `${major}-stable`;
}

function envCurrentStableMajor() {
  const v = (process.env.CAMUNDA_SDK_CURRENT_STABLE_MAJOR || '').trim();
  return /^\d+$/.test(v) ? v : null;
}

function maintenanceBranchConfig(branchName, major) {
  return {
    name: branchName,
    range: `${major}.x`,
    channel: stableDistTagForMajor(major),
  };
}

function dedupeBranches(branches) {
  const seen = new Set();
  const out = [];
  for (const b of branches) {
    const name = typeof b === 'string' ? b : b?.name;
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Computed branch context
// ---------------------------------------------------------------------------

const branch = currentBranchName();
const stableMajor = stableMajorFromBranch(branch);
const currentStableMajor = envCurrentStableMajor();
const isOnMain = branch === 'main';
const isOnCurrentStable = Boolean(stableMajor && stableMajor === currentStableMajor);

// ---------------------------------------------------------------------------
// Base config
// ---------------------------------------------------------------------------

module.exports = {
  // Branch model:
  // - main: alpha prereleases (dist-tag: alpha)
  // - stable/<major> (current): stable releases (dist-tag: latest)
  // - stable/<major> (older): maintenance stream (dist-tag: <major>-stable)
  //
  // SDK major version tracks Camunda server minor (server 8.9 → SDK 9.x).
  // The currently promoted stable major is configured via CAMUNDA_SDK_CURRENT_STABLE_MAJOR.
  //
  // semantic-release requires ≥1 "release branch" (no `range`, no `prerelease`).
  // Branch type classification (lib/definitions/branches.js):
  //   `range`      → maintenance
  //   `prerelease` → pre-release
  //   neither      → release
  //
  // The config is evaluated per-branch CI run, so each branch only needs
  // to make sense for its own run. We use the current branch to decide
  // which role each entry plays:
  //
  // On main:
  //   main        → prerelease (alpha)
  //   stable/N    → release branch (satisfies ≥1 constraint)
  //
  // On stable/N (current):
  //   stable/N    → maintenance with range N.x (constrains versions)
  //   main        → release branch (satisfies ≥1 constraint)
  //
  // On stable/N (older):
  //   stable/N    → maintenance with range N.x
  branches: dedupeBranches([
    // main: prerelease when running on main, plain release branch otherwise.
    isOnMain ? { name: 'main', prerelease: 'alpha', channel: 'alpha' } : { name: 'main' },

    // Current stable line: constrained with range when running on it,
    // plain release branch when running from main.
    ...(currentStableMajor
      ? [
          {
            name: `stable/${currentStableMajor}`,
            ...(isOnCurrentStable ? { range: `${currentStableMajor}.x` } : {}),
            channel: 'latest',
          },
        ]
      : []),

    // Any other stable/* branch publishes as a maintenance line.
    ...(stableMajor && stableMajor !== currentStableMajor
      ? [maintenanceBranchConfig(branch, stableMajor)]
      : []),
  ]),

  // Base plugins — SDK repos append language-specific plugins after these.
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        releaseRules: [
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { breaking: true, release: 'major' },
        ],
      },
    ],
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
  ],

  // Export helpers for SDK-specific configs
  _helpers: {
    currentBranchName,
    stableMajorFromBranch,
    stableDistTagForMajor,
    envCurrentStableMajor,
    maintenanceBranchConfig,
    dedupeBranches,
    branch,
    stableMajor,
    currentStableMajor,
    isOnMain,
    isOnCurrentStable,
  },
};
