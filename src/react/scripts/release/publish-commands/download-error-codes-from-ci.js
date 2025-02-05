#!/usr/bin/env node

'use strict';

const {exec} = require('child-process-promise');
const {readJsonSync} = require('fs-extra');
const {join} = require('path');
const {getArtifactsList, logPromise} = require('../utils');
const theme = require('../theme');

const run = async ({cwd, packages, tags}) => {
  if (!tags.includes('latest')) {
    // Don't update error-codes for alphas.
    return;
  }

  // All packages are built from a single source revision,
  // so it is safe to read build info from any one of them.
  const arbitraryPackageName = packages[0];
  const {buildNumber, environment} = readJsonSync(
    join(cwd, 'build', 'node_modules', arbitraryPackageName, 'build-info.json')
  );

  // If this release was created on Circle CI, grab the updated error codes from there.
  // Else the user will have to manually regenerate them.
  if (environment === 'ci') {
    const artifacts = await getArtifactsList(buildNumber);

    // Each container stores an "error-codes" artifact, unfortunately.
    // We want to use the one that also ran `yarn build` since it may have modifications.
    const {node_index} = artifacts.find(
      entry => entry.path === 'home/circleci/project/node_modules.tgz'
    );
    const {url} = artifacts.find(
      entry =>
        entry.node_index === node_index &&
        entry.path === 'home/circleci/project/scripts/error-codes/codes.json'
    );

    // Download and stage changers
    await exec(`curl ${url} --output ./scripts/error-codes/codes.json`, {cwd});
  }
};

module.exports = async params => {
  return logPromise(run(params), theme`Retrieving error codes`);
};
