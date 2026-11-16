// Shared commitlint base configuration for all Camunda SDK repos.
//
// Usage in SDK repos:
//   module.exports = require('@camunda8/sdk-infra/configs/commitlint.config.base.cjs');
//
// Or extend with overrides:
//   const base = require('@camunda8/sdk-infra/configs/commitlint.config.base.cjs');
//   module.exports = {
//     ...base,
//     rules: {
//       ...base.rules,
//       'header-max-length': [2, 'always', 120],
//     },
//   };

const FOOTER_MAX_LINE_LENGTH = 100;

// GitHub writes `Co-authored-by: <name> <id+login@users.noreply.github.com>` trailers on
// squash merges; a bot's runs past 100 characters and fails every PR that backports it.
const footerMaxLineLengthExceptCoAuthors = (parsed, when = 'always', value = FOOTER_MAX_LINE_LENGTH) => {
  const long = (parsed.footer ?? '')
    .split(/\r?\n/)
    .filter((line) => !/^co-authored-by:/i.test(line) && line.length > value);
  const ok = when === 'never' ? long.length > 0 : long.length === 0;
  return [ok, `footer's lines must not be longer than ${value} characters (Co-authored-by lines excepted)`];
};

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'footer-max-line-length-except-co-authors': footerMaxLineLengthExceptCoAuthors,
      },
    },
  ],
  rules: {
    // No PascalCase subjects (proper nouns excepted by convention)
    'subject-case': [2, 'never', ['pascal-case']],
    // Allow longer subjects/headers for Dependabot multi-package bumps
    'header-max-length': [2, 'always', 200],
    'subject-max-length': [2, 'always', 200],
    'subject-min-length': [2, 'always', 5],
    // Allow long body lines (dependency updates, URLs, detailed explanations)
    'body-max-line-length': [2, 'always', 500],
    // config-conventional's footer limit, without Co-authored-by trailers.
    'footer-max-line-length': [0],
    'footer-max-line-length-except-co-authors': [2, 'always', FOOTER_MAX_LINE_LENGTH],
  },
};
