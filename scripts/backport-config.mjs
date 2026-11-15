#!/usr/bin/env node
// Validate and apply an SDK's backport configuration (.github/backport.yml).
//
// sdk-backport.yml converts the YAML to JSON with `yq` (preinstalled on GitHub's
// Ubuntu runners) and calls this script, so the config needs no YAML parser and
// adds no runtime dependency. See schema/backport.schema.json.
//
//   node backport-config.mjs resolve --config cfg.json --from main --to stable/10 --changed files.txt
//     Prints { language, generatedPaths, regenerate, postCherryPick, blocked[] } as JSON.
//   node backport-config.mjs check-diff --config cfg.json --changed files.txt
//     Exits 1 if any changed file lies outside generated-paths.
//   node backport-config.mjs check-adapt --config cfg.json --changed adapt.txt --allowed backport.txt
//     Exits 1 if the post-cherry-pick commit changes a file the backport doesn't, or
//     a generated path.
//   node backport-config.mjs hand-written --config cfg.json --changed files.txt
//     Prints the changed files outside generated-paths, NUL-separated: the list
//     post-cherry-pick gets as BACKPORT_CHANGED_FILES.
//
// All exit 2 (with `::error::` lines) when the config is invalid.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LANGUAGES = ['js', 'python', 'csharp', 'go', 'rust', 'java'];
const KEYS = ['language', 'generated-paths', 'regenerate', 'post-cherry-pick', 'do-not-backport'];
const RULE_KEYS = ['paths', 'from', 'reason'];

/**
 * Glob match: `**` spans directories, `*` stays within one. A pattern without
 * `/` matches the file name at any depth. Leading `./` is ignored on both sides.
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
      } else if (glob.startsWith('**', i)) {
        out += '.*';
        i += 1;
      } else if (glob[i] === '*') {
        out += '[^/]*';
      } else if (glob[i] === '?') {
        out += '[^/]';
      } else {
        out += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
    }
    // dotAll: `.` must match a newline too, or a file name containing one escapes `**` rules.
    return new RegExp(`^${out}$`, 's');
  };
  if (toRe(p).test(f)) return true;
  if (!p.includes('/')) return toRe(`**/${p}`).test(f);
  return false;
}

/** True if `file` is a generated path or lies under one (paths are files or directories). */
export function isGenerated(generatedPaths, file) {
  const f = file.replace(/^\.\//, '');
  return generatedPaths.some((raw) => {
    const p = raw.replace(/^\.\//, '').replace(/\/+$/, '');
    return f === p || f.startsWith(`${p}/`);
  });
}

const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

/** Returns a list of human-readable problems; empty means valid. */
export function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['the file is empty or not a mapping'];
  }
  const errors = [];
  for (const key of Object.keys(config)) {
    if (!KEYS.includes(key)) errors.push(`unknown key "${key}" (expected one of: ${KEYS.join(', ')})`);
  }
  if ('language' in config && !LANGUAGES.includes(config.language)) {
    errors.push(`language must be one of ${LANGUAGES.join(', ')}, or omitted`);
  }
  const paths = config['generated-paths'];
  if (paths === undefined) {
    errors.push('generated-paths is required (use [] to turn regeneration off)');
  } else if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && p.length > 0)) {
    errors.push('generated-paths must be a list of non-empty strings');
  } else {
    for (const p of paths) {
      if (/[*?[\]]/.test(p)) errors.push(`generated-paths entry "${p}" is a glob; list plain files or directories`);
      if (p.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(p)) errors.push(`generated-paths entry "${p}" must be relative to the repo root`);
    }
    if (new Set(paths).size !== paths.length) errors.push('generated-paths has duplicate entries');
    if (paths.length > 0 && !(typeof config.regenerate === 'string' && config.regenerate.trim())) {
      errors.push('regenerate (the command) is required when generated-paths is not empty');
    }
  }
  if ('regenerate' in config && typeof config.regenerate !== 'string') errors.push('regenerate must be a string');
  if ('post-cherry-pick' in config && !(typeof config['post-cherry-pick'] === 'string' && config['post-cherry-pick'].trim())) {
    errors.push('post-cherry-pick must be a non-empty string (the command), or omitted');
  }
  const rules = config['do-not-backport'];
  if (rules !== undefined) {
    if (!Array.isArray(rules)) {
      errors.push('do-not-backport must be a list');
    } else {
      rules.forEach((rule, i) => {
        if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
          errors.push(`do-not-backport[${i}] must be a mapping`);
          return;
        }
        for (const key of Object.keys(rule)) {
          if (!RULE_KEYS.includes(key)) errors.push(`do-not-backport[${i}] has unknown key "${key}"`);
        }
        if (!isStringList(rule.paths) || rule.paths.length === 0) errors.push(`do-not-backport[${i}].paths must be a non-empty list of strings`);
        if ('from' in rule && !isStringList(rule.from)) errors.push(`do-not-backport[${i}].from must be a list of strings`);
        if ('reason' in rule && typeof rule.reason !== 'string') errors.push(`do-not-backport[${i}].reason must be a string`);
      });
    }
  }
  return errors;
}

/** Changed files that a do-not-backport rule forbids for a backport from `from`. */
export function blockedFiles(config, { from, changed }) {
  const out = [];
  for (const rule of config['do-not-backport'] ?? []) {
    if (rule.from?.length && !rule.from.includes(from)) continue;
    for (const file of changed) {
      const pattern = rule.paths.find((p) => matchGlob(p, file));
      if (pattern) out.push({ file, pattern, reason: rule.reason ?? '' });
    }
  }
  return out;
}

export function resolve(config, { from, changed }) {
  return {
    language: config.language ?? '',
    generatedPaths: config['generated-paths'],
    regenerate: config.regenerate ?? '',
    postCherryPick: config['post-cherry-pick'] ?? '',
    blocked: blockedFiles(config, { from, changed }),
  };
}

/** Changed files outside generated-paths: a regeneration commit must not touch them. */
export function outsideGenerated(config, changed) {
  return changed.filter((f) => !isGenerated(config['generated-paths'], f));
}

/**
 * Files the post-cherry-pick commit changes that it may not: anything the backport
 * itself doesn't change, and any generated path (the regeneration commit owns those).
 * Names are compared byte for byte.
 */
export function adaptOutsideBackport(config, changed, backportChanged) {
  const allowed = new Set(backportChanged);
  return changed.filter((f) => !allowed.has(f) || isGenerated(config['generated-paths'], f));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument: ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, opts };
}

// File lists come from `git diff -z`: NUL-separated and unquoted. Names are kept
// byte for byte (no trimming): ` client/x` is not `client/x`, and the generated-path
// check is a security boundary. Newline-separated input is accepted for local use.
export const readFileList = (text) => text.split(text.includes('\0') ? '\0' : '\n').filter((l) => l !== '');
const readLines = (path) => readFileList(readFileSync(path, 'utf8'));

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const { command, opts } = parseArgs(argv);
  const commands = ['resolve', 'check-diff', 'check-adapt', 'hand-written'];
  if (!commands.includes(command)) throw new Error(`unknown command: ${command} (expected ${commands.join(', ')})`);
  if (!opts.config) throw new Error('--config is required');
  if (command === 'check-adapt' && !opts.allowed) throw new Error('--allowed is required');
  const config = JSON.parse(readFileSync(opts.config, 'utf8') || 'null');
  const errors = validateConfig(config);
  if (errors.length) {
    for (const e of errors) stderr.write(`::error::.github/backport.yml: ${e}\n`);
    return 2;
  }
  const changed = opts.changed ? readLines(opts.changed) : [];
  if (command === 'resolve') {
    stdout.write(`${JSON.stringify(resolve(config, { from: opts.from ?? '', changed }))}\n`);
    return 0;
  }
  if (command === 'check-diff') {
    const outside = outsideGenerated(config, changed);
    for (const f of outside) stderr.write(`::error::${f} is not a generated path\n`);
    return outside.length ? 1 : 0;
  }
  if (command === 'hand-written') {
    for (const f of outsideGenerated(config, changed)) stdout.write(`${f}\0`);
    return 0;
  }
  if (command === 'check-adapt') {
    const outside = adaptOutsideBackport(config, changed, readLines(opts.allowed));
    for (const f of outside) stderr.write(`::error::${f} is not a hand-written file this backport changes\n`);
    return outside.length ? 1 : 0;
  }
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`::error::${err.message}\n`);
    process.exitCode = 2;
  }
}
