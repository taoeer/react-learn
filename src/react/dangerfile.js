/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

// Hi, if this is your first time editing/reading a Dangerfile, here's a summary:
// It's a JS runtime which helps you provide continuous feedback inside GitHub.
//
// You can see the docs here: http://danger.systems/js/
//
// If you want to test changes Danger, I'd recommend checking out an existing PR
// and then running the `danger pr` command.
//
// You'll need a GitHub token, you can re-use this one:
//
//  0a7d5c3cad9a6dbec2d9 9a5222cf49062a4c1ef7
//
// (Just remove the space)
//
// So, for example:
//
// `DANGER_GITHUB_API_TOKEN=[ENV_ABOVE] yarn danger pr https://github.com/facebook/react/pull/11865

const {markdown, danger, warn} = require('danger');
const fetch = require('node-fetch');

const {generateResultsArray} = require('./scripts/rollup/stats');
const {existsSync, readFileSync} = require('fs');
const {exec} = require('child_process');

// This must match the name of the CI job that creates the build artifacts
const RELEASE_CHANNEL =
  process.env.RELEASE_CHANNEL === 'experimental' ? 'experimental' : 'stable';
const artifactsJobName =
  process.env.RELEASE_CHANNEL === 'experimental'
    ? 'process_artifacts_experimental'
    : 'process_artifacts';

if (!existsSync('./build/bundle-sizes.json')) {
  // This indicates the build failed previously.
  // In that case, there's nothing for the Dangerfile to do.
  // Exit early to avoid leaving a redundant (and potentially confusing) PR comment.
  warn(
    'No bundle size information found. This indicates the build ' +
      'job failed.'
  );
  process.exit(0);
}

const currentBuildResults = JSON.parse(
  readFileSync('./build/bundle-sizes.json')
);

/**
 * Generates a Markdown table
 * @param {string[]} headers
 * @param {string[][]} body
 */
function generateMDTable(headers, body) {
  const tableHeaders = [
    headers.join(' | '),
    headers.map(() => ' --- ').join(' | '),
  ];

  const tablebody = body.map(r => r.join(' | '));
  return tableHeaders.join('\n') + '\n' + tablebody.join('\n');
}

/**
 * Generates a user-readable string from a percentage change
 * @param {number} change
 * @param {boolean} includeEmoji
 */
function addPercent(change, includeEmoji) {
  if (!isFinite(change)) {
    // When a new package is created
    return 'n/a';
  }
  const formatted = (change * 100).toFixed(1);
  if (/^-|^0(?:\.0+)$/.test(formatted)) {
    return `${formatted}%`;
  } else {
    if (includeEmoji) {
      return `:small_red_triangle:+${formatted}%`;
    } else {
      return `+${formatted}%`;
    }
  }
}

function setBoldness(row, isBold) {
  if (isBold) {
    return row.map(element => `**${element}**`);
  } else {
    return row;
  }
}

/**
 * Gets the commit that represents the merge between the current branch
 * and master.
 */
function git(args) {
  return new Promise(res => {
    exec('git ' + args, (err, stdout, stderr) => {
      if (err) {
        throw err;
      } else {
        res(stdout.trim());
      }
    });
  });
}

(async function() {
  // Use git locally to grab the commit which represents the place
  // where the branches differ
  const upstreamRepo = danger.github.pr.base.repo.full_name;
  if (upstreamRepo !== 'facebook/react') {
    // Exit unless we're running in the main repo
    return;
  }

  markdown(`## Size changes (${RELEASE_CHANNEL})`);

  const upstreamRef = danger.github.pr.base.ref;
  await git(`remote add upstream https://github.com/facebook/react.git`);
  await git('fetch upstream');
  const baseCommit = await git(`merge-base HEAD upstream/${upstreamRef}`);

  let previousBuildResults = null;
  try {
    let baseCIBuildId = null;
    const statusesResponse = await fetch(
      `https://api.github.com/repos/facebook/react/commits/${baseCommit}/status`
    );
    const {statuses, state} = await statusesResponse.json();
    if (state === 'failure') {
      warn(`Base commit is broken: ${baseCommit}`);
      return;
    }
    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i];
      if (status.context === `ci/circleci: ${artifactsJobName}`) {
        if (status.state === 'success') {
          baseCIBuildId = /\/facebook\/react\/([0-9]+)/.exec(
            status.target_url
          )[1];
          break;
        }
        if (status.state === 'pending') {
          warn(`Build job for base commit is still pending: ${baseCommit}`);
          return;
        }
      }
    }

    if (baseCIBuildId === null) {
      warn(`Could not find build artifacts for base commit: ${baseCommit}`);
      return;
    }

    const baseArtifactsInfoResponse = await fetch(
      `https://circleci.com/api/v1.1/project/github/facebook/react/${baseCIBuildId}/artifacts`
    );
    const baseArtifactsInfo = await baseArtifactsInfoResponse.json();

    for (let i = 0; i < baseArtifactsInfo.length; i++) {
      const info = baseArtifactsInfo[i];
      if (info.path.endsWith('bundle-sizes.json')) {
        const resultsResponse = await fetch(info.url);
        previousBuildResults = await resultsResponse.json();
        break;
      }
    }
  } catch (error) {
    warn(`Failed to fetch build artifacts for base commit: ${baseCommit}`);
    return;
  }

  if (previousBuildResults === null) {
    warn(`Could not find build artifacts for base commit: ${baseCommit}`);
    return;
  }

  // Take the JSON of the build response and
  // make an array comparing the results for printing
  const results = generateResultsArray(
    currentBuildResults,
    previousBuildResults
  );

  const packagesToShow = results
    .filter(
      r =>
        Math.abs(r.prevFileSizeAbsoluteChange) >= 300 || // bytes
        Math.abs(r.prevGzipSizeAbsoluteChange) >= 100 // bytes
    )
    .map(r => r.packageName);

  if (packagesToShow.length) {
    let allTables = [];

    // Highlight React and React DOM changes inline
    // e.g. react: `react.production.min.js`: -3%, `react.development.js`: +4%

    if (packagesToShow.includes('react')) {
      const reactProd = results.find(
        r => r.bundleType === 'UMD_PROD' && r.packageName === 'react'
      );
      if (
        reactProd.prevFileSizeChange !== 0 ||
        reactProd.prevGzipSizeChange !== 0
      ) {
        const changeSize = addPercent(reactProd.prevFileSizeChange, true);
        const changeGzip = addPercent(reactProd.prevGzipSizeChange, true);
        markdown(`React: size: ${changeSize}, gzip: ${changeGzip}`);
      }
    }

    if (packagesToShow.includes('react-dom')) {
      const reactDOMProd = results.find(
        r => r.bundleType === 'UMD_PROD' && r.packageName === 'react-dom'
      );
      if (
        reactDOMProd.prevFileSizeChange !== 0 ||
        reactDOMProd.prevGzipSizeChange !== 0
      ) {
        const changeSize = addPercent(reactDOMProd.prevFileSizeChange, true);
        const changeGzip = addPercent(reactDOMProd.prevGzipSizeChange, true);
        markdown(`ReactDOM: size: ${changeSize}, gzip: ${changeGzip}`);
      }
    }

    // Show a hidden summary table for all diffs

    // eslint-disable-next-line no-var,no-for-of-loops/no-for-of-loops
    for (var name of new Set(packagesToShow)) {
      const thisBundleResults = results.filter(r => r.packageName === name);
      const changedFiles = thisBundleResults.filter(
        r => r.prevFileSizeChange !== 0 || r.prevGzipSizeChange !== 0
      );

      const mdHeaders = [
        'File',
        'Filesize Diff',
        'Gzip Diff',
        'Prev Size',
        'Current Size',
        'Prev Gzip',
        'Current Gzip',
        'ENV',
      ];

      const mdRows = changedFiles.map(r => {
        const isProd = r.bundleType.includes('PROD');
        return setBoldness(
          [
            r.filename,
            addPercent(r.prevFileSizeChange, isProd),
            addPercent(r.prevGzipSizeChange, isProd),
            r.prevSize,
            r.prevFileSize,
            r.prevGzip,
            r.prevGzipSize,
            r.bundleType,
          ],
          isProd
        );
      });

      allTables.push(`\n## ${name}`);
      allTables.push(generateMDTable(mdHeaders, mdRows));
    }

    const summary = `
  <details>
  <summary>Details of bundled changes.</summary>

  <p>Comparing: ${baseCommit}...${danger.github.pr.head.sha}</p>


  ${allTables.join('\n')}

  </details>
  `;
    markdown(summary);
  } else {
    markdown('No significant bundle size changes to report.');
  }
})();
