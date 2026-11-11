#!/usr/bin/env node
// Classify a merged PR's commits for a handwritten-only backport.
//
// Reads `.github/backport.yml` (required) and a JSON list of commits
// `{ sha, subject, files[] }`, plus the source and target branch names.
// Prints a JSON plan on stdout:
//   { action: "cherry-pick" | "skip" | "fail", reason, shas?, skipped?, mixed? }
//
// A missing config file is a fail (do not guess paths). An empty-but-present
// file uses the schema defaults. See schema/backport.schema.json and
// camunda/sdk-infra#81.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = {
  'skip-paths': ['src/gen/**', 'external-spec/**', 'spec-snapshots/**'],
  'skip-subjects': ['chore(gen):', 'chore(regen):'],
  'do-not-backport': [],
};

/**
 * Minimatch-lite: `**` matches any path segment run, `*` matches within a
 * segment. Leading `./` on either side is ignored.
 */
export function matchGlob(pattern, file) {
  const norm = (s) => s.replace(/^\.\//, '').replace(/\\/g, '/');
  const p = norm(pattern);
  const f = norm(file);
  const toRe = (glob) => {
    let out = '';
    for (let i = 0; i < glob.length; i += 1) {
      if (glob.startsWith('**/', i)) {
        out += '(?:.*/)?';
        i += 2;
      } else if (glob[i] === '*' && glob[i + 1] !== '*') {
        out += '[^/]*';
      } else if (glob.startsWith('**', i) && (glob[i + 2] === undefined || glob[i + 2] === '/')) {
        out += '.*';
        i += 1;
      } else {
        out += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp(`^${out}$`);
  };
  if (toRe(p).test(f)) return true;
  if (!p.includes('/')) return toRe(`**/${p}`).test(f);
  return false;
}

export function parseYaml(text) {
  // Tiny subset: mappings of string → list-of-strings, and do-not-backport
  // as a list of { paths, from?, to? } objects. Comments and blank lines
  // ignored. Good enough for the schema; a full YAML parser would be a
  // new runtime dependency for a ten-line config.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = {};
  let key = null;
  let item = null;
  let itemKey = null;
  const flushItem = () => {
    if (item && key === 'do-not-backport') {
      out[key] = out[key] || [];
      out[key].push(item);
    }
    item = null;
    itemKey = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top && !/^[ \t]/.test(line) && !line.trimStart().startsWith('-')) {
      flushItem();
      key = top[1];
      out[key] = top[2] ? yamlScalar(top[2]) : [];
      item = null;
      continue;
    }
    if (key === 'do-not-backport') {
      const nested = /^[ \t]+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      const dash = /^[ \t]*-[ \t]+(.*)$/.exec(line);
      if (dash && !nested) {
        const indent = line.match(/^[ \t]*/)[0].length;
        if (indent <= 2) {
          flushItem();
          item = { paths: [] };
          const rest = dash[1];
          const inline = /^paths:\s*(.*)$/.exec(rest.trim());
          if (inline) {
            itemKey = 'paths';
            if (inline[1]) item.paths = yamlList(inline[1]);
          } else if (rest) {
            item.paths = [yamlScalar(rest)];
          }
          continue;
        }
      }
      if (nested && item) {
        itemKey = nested[1];
        if (nested[2]) item[itemKey] = yamlList(nested[2]);
        else item[itemKey] = item[itemKey] || [];
        continue;
      }
      if (dash && item && itemKey) {
        item[itemKey] = item[itemKey] || [];
        item[itemKey].push(yamlScalar(dash[1]));
        continue;
      }
    } else if (key) {
      const entry = /^[ \t]*-[ \t]+(.*)$/.exec(line);
      if (entry) {
        if (!Array.isArray(out[key])) out[key] = [];
        out[key].push(yamlScalar(entry[1]));
      }
    }
  }
  flushItem();
  return out;
}

function yamlScalar(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function yamlList(s) {
  const t = s.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((x) => yamlScalar(x))
      .filter(Boolean);
  }
  if (!t) return [];
  return [yamlScalar(t)];
}

export function loadConfig(text) {
  const parsed = text.trim() ? parseYaml(text) : {};
  return {
    'skip-paths':
      Array.isArray(parsed['skip-paths']) && parsed['skip-paths'].length
        ? parsed['skip-paths']
        : DEFAULTS['skip-paths'],
    'skip-subjects':
      Array.isArray(parsed['skip-subjects']) && parsed['skip-subjects'].length
        ? parsed['skip-subjects']
        : DEFAULTS['skip-subjects'],
    'do-not-backport': Array.isArray(parsed['do-not-backport'])
      ? parsed['do-not-backport']
      : DEFAULTS['do-not-backport'],
  };
}

function matchesAny(globs, file) {
  return globs.some((g) => matchGlob(g, file));
}

function subjectSkipped(prefixes, subject) {
  return prefixes.some((p) => subject.startsWith(p));
}

function ruleApplies(rule, source, target) {
  const from = rule.from ?? [];
  const to = rule.to ?? [];
  if (from.length && !from.includes(source)) return false;
  if (to.length && !to.includes(target)) return false;
  return true;
}

/**
 * @param {{ sha: string, subject: string, files: string[] }[]} commits
 * @param {ReturnType<typeof loadConfig>} config
 * @param {string} source
 * @param {string} target
 */
export function planBackport(commits, config, source, target) {
  const skipPaths = config['skip-paths'];
  const skipSubjects = config['skip-subjects'];
  const blocked = [];
  const keep = [];
  const skipped = [];
  const mixed = [];

  for (const commit of commits) {
    const files = commit.files ?? [];
    if (subjectSkipped(skipSubjects, commit.subject)) {
      skipped.push({ sha: commit.sha, reason: 'skip-subject', subject: commit.subject });
      continue;
    }
    if (files.length === 0) {
      keep.push(commit);
      continue;
    }
    const gen = files.filter((f) => matchesAny(skipPaths, f));
    const hand = files.filter((f) => !matchesAny(skipPaths, f));
    if (gen.length && hand.length) {
      mixed.push({ sha: commit.sha, subject: commit.subject, generated: gen, handwritten: hand });
      continue;
    }
    if (gen.length && !hand.length) {
      skipped.push({ sha: commit.sha, reason: 'skip-paths', subject: commit.subject, files: gen });
      continue;
    }
    keep.push(commit);
  }

  if (mixed.length) {
    return {
      action: 'fail',
      reason:
        'mixed-commit: a commit touches both handwritten and generated paths. Split it (generator/handwritten first, chore(gen): regenerate second) and re-label.',
      mixed,
    };
  }

  if (!keep.length) {
    return {
      action: 'skip',
      reason: 'nothing-handwritten: every commit was regen-only or matched skip-paths / skip-subjects.',
      skipped,
      shas: [],
    };
  }

  for (const commit of keep) {
    for (const rule of config['do-not-backport']) {
      if (!ruleApplies(rule, source, target)) continue;
      const hit = (commit.files ?? []).filter((f) => matchesAny(rule.paths ?? [], f));
      if (hit.length) {
        blocked.push({ sha: commit.sha, subject: commit.subject, files: hit, rule });
      }
    }
  }
  if (blocked.length) {
    return {
      action: 'skip',
      reason:
        'do-not-backport: remaining commits touch paths this repo will not cherry-pick between these lines (open a stable-only PR, or port by hand).',
      blocked,
      skipped,
      shas: [],
    };
  }

  return {
    action: 'cherry-pick',
    reason: `cherry-pick ${keep.length} handwritten commit(s) onto ${target}`,
    shas: keep.map((c) => c.sha),
    skipped,
  };
}

export function planFromFiles({ configPath, commitsPath, source, target }) {
  let configText;
  try {
    configText = readFileSync(configPath, 'utf8');
  } catch {
    return {
      action: 'fail',
      reason: `missing-config: ${configPath} is required (camunda/sdk-infra#81). Add .github/backport.yml; the workflow will not guess generated-code paths.`,
    };
  }
  const commits = JSON.parse(readFileSync(commitsPath, 'utf8'));
  return planBackport(commits, loadConfig(configText), source, target);
}

function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.config || !args.commits || !args.source || !args.target) {
    console.error(
      'usage: plan-backport.mjs --config <file> --commits <file> --source <branch> --target <branch>',
    );
    process.exit(2);
  }
  const plan = planFromFiles({
    configPath: args.config,
    commitsPath: args.commits,
    source: args.source,
    target: args.target,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
