'use strict';

const {esNextPaths} = require('./scripts/shared/pathsByLanguageVersion');

module.exports = {
  bracketSpacing: false,
  singleQuote: true,
  jsxBracketSameLine: true,
  trailingComma: 'es5',
  printWidth: 80,
  parser: 'babel',

  overrides: [
    {
      files: esNextPaths,
      options: {
        trailingComma: 'all',
      },
    },
  ],
};
