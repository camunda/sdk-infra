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

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // No PascalCase subjects (proper nouns excepted by convention)
    'subject-case': [2, 'never', ['pascal-case']],
    // Enforce concise subjects for better changelog readability
    'subject-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 5],
    // Allow long body lines (dependency updates, URLs, detailed explanations)
    'body-max-line-length': [2, 'always', 500],
  },
};
