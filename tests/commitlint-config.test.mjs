// Tests for configs/commitlint.config.base.cjs
//
// GitHub squash merges add `Co-authored-by: <name> <id+login@users.noreply.github.com>`
// trailers. The camunda-sdk-automation bot's is 108 characters, so every backport of a
// squash commit it co-authored failed footer-max-line-length. The replacement rule must
// skip exactly those trailers and keep the 100-character limit for everything else.
//
// commitlint isn't a dependency here, so the rule is exercised directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../configs/commitlint.config.base.cjs");

const RULE = "footer-max-line-length-except-co-authors";
const rule = config.plugins
  .map((p) => p.rules?.[RULE])
  .find(Boolean);
const [, when, max] = config.rules[RULE];
const check = (footer) => rule({ footer }, when, max)[0];

const BOT_CO_AUTHOR =
  "Co-authored-by: camunda-sdk-automation[bot] <290741040+camunda-sdk-automation[bot]@users.noreply.github.com>";

describe("commitlint base config: footer line length", () => {
  it("replaces config-conventional's footer-max-line-length", () => {
    assert.deepEqual(config.rules["footer-max-line-length"], [0]);
    assert.equal(typeof rule, "function");
    assert.deepEqual(config.rules[RULE], [2, "always", 100]);
  });

  it("allows a Co-authored-by trailer longer than the limit", () => {
    assert.ok(BOT_CO_AUTHOR.length > 100);
    assert.equal(check(`${BOT_CO_AUTHOR}\nCo-authored-by: Emily Oram <emily.oram@camunda.com>`), true);
    assert.equal(check(BOT_CO_AUTHOR.replace("Co-authored-by", "co-authored-by")), true);
  });

  it("still rejects any other footer line longer than the limit", () => {
    assert.equal(check(`${BOT_CO_AUTHOR}\nRefs: ${"x".repeat(100)}`), false);
    assert.equal(check(`BREAKING CHANGE: ${"x".repeat(90)}`), false);
    // Only a trailer at the start of a line counts.
    assert.equal(check(`Note: see ${BOT_CO_AUTHOR}`), false);
  });

  it("allows footer lines up to exactly the limit, and an empty footer", () => {
    assert.equal(check("x".repeat(100)), true);
    assert.equal(check("x".repeat(101)), false);
    assert.equal(check(null), true);
  });
});
