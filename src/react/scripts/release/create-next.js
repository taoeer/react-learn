#!/usr/bin/env node

'use strict';

const {tmpdir} = require('os');
const {join} = require('path');
const {getBuildInfo, handleError} = require('./utils');

// This script is an escape hatch!
// It exists for special case manual builds.
// The typical suggested release process is to create a "next" build from a CI artifact.
// This build script is optimized for speed and simplicity.
// It doesn't run all of the tests that the CI environment runs.
// You're expected to run those manually before publishing a release.

const addBuildInfoJSON = require('./create-next-commands/add-build-info-json');
const buildArtifacts = require('./create-next-commands/build-artifacts');
const confirmAutomatedTesting = require('./create-next-commands/confirm-automated-testing');
const copyRepoToTempDirectory = require('./create-next-commands/copy-repo-to-temp-directory');
const npmPackAndUnpack = require('./create-next-commands/npm-pack-and-unpack');
const printPrereleaseSummary = require('./shared-commands/print-prerelease-summary');
const updateVersionNumbers = require('./create-next-commands/update-version-numbers');

const run = async () => {
  try {
    const cwd = join(__dirname, '..', '..');
    const {
      branch,
      checksum,
      commit,
      reactVersion,
      version,
    } = await getBuildInfo();
    const tempDirectory = join(tmpdir(), `react-${commit}`);
    const params = {
      branch,
      checksum,
      commit,
      cwd,
      reactVersion,
      tempDirectory,
      version,
    };

    await confirmAutomatedTesting(params);
    await copyRepoToTempDirectory(params);
    await updateVersionNumbers(params);
    await addBuildInfoJSON(params);
    await buildArtifacts(params);
    await npmPackAndUnpack(params);
    await printPrereleaseSummary(params, false);
  } catch (error) {
    handleError(error);
  }
};

run();
