'use strict';

const {bundleTypes, moduleTypes} = require('./bundles');
const reactVersion = require('../../package.json').version;

const {
  UMD_DEV,
  UMD_PROD,
  UMD_PROFILING,
  NODE_DEV,
  NODE_PROD,
  NODE_PROFILING,
  FB_WWW_DEV,
  FB_WWW_PROD,
  FB_WWW_PROFILING,
  RN_OSS_DEV,
  RN_OSS_PROD,
  RN_OSS_PROFILING,
  RN_FB_DEV,
  RN_FB_PROD,
  RN_FB_PROFILING,
} = bundleTypes;

const {RECONCILER} = moduleTypes;

const license = ` * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.`;

const wrappers = {
  /***************** UMD_DEV *****************/
  [UMD_DEV](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */

'use strict';

${source}`;
  },

  /***************** UMD_PROD *****************/
  [UMD_PROD](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */
${source}`;
  },

  /***************** UMD_PROFILING *****************/
  [UMD_PROFILING](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */
${source}`;
  },

  /***************** NODE_DEV *****************/
  [NODE_DEV](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */

'use strict';

${
  globalName === 'ReactNoopRenderer' ||
  globalName === 'ReactNoopRendererPersistent'
    ? // React Noop needs regenerator runtime because it uses
      // generators but GCC doesn't handle them in the output.
      // So we use Babel for them.
      `const regeneratorRuntime = require("regenerator-runtime");`
    : ``
}

if (process.env.NODE_ENV !== "production") {
  (function() {
${source}
  })();
}`;
  },

  /***************** NODE_PROD *****************/
  [NODE_PROD](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */
${
  globalName === 'ReactNoopRenderer' ||
  globalName === 'ReactNoopRendererPersistent'
    ? // React Noop needs regenerator runtime because it uses
      // generators but GCC doesn't handle them in the output.
      // So we use Babel for them.
      `const regeneratorRuntime = require("regenerator-runtime");`
    : ``
}
${source}`;
  },

  /***************** NODE_PROFILING *****************/
  [NODE_PROFILING](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */
${
  globalName === 'ReactNoopRenderer' ||
  globalName === 'ReactNoopRendererPersistent'
    ? // React Noop needs regenerator runtime because it uses
      // generators but GCC doesn't handle them in the output.
      // So we use Babel for them.
      `const regeneratorRuntime = require("regenerator-runtime");`
    : ``
}
${source}`;
  },

  /****************** FB_WWW_DEV ******************/
  [FB_WWW_DEV](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * @preserve-invariant-messages
 */

'use strict';

if (__DEV__) {
  (function() {
${source}
  })();
}`;
  },

  /****************** FB_WWW_PROD ******************/
  [FB_WWW_PROD](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * @preserve-invariant-messages
 */

${source}`;
  },

  /****************** FB_WWW_PROFILING ******************/
  [FB_WWW_PROFILING](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * @preserve-invariant-messages
 */

${source}`;
  },

  /****************** RN_OSS_DEV ******************/
  [RN_OSS_DEV](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @providesModule ${globalName}-dev
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

'use strict';

if (__DEV__) {
  (function() {
${source}
  })();
}`;
  },

  /****************** RN_OSS_PROD ******************/
  [RN_OSS_PROD](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @providesModule ${globalName}-prod
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

${source}`;
  },

  /****************** RN_OSS_PROFILING ******************/
  [RN_OSS_PROFILING](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @providesModule ${globalName}-profiling
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

${source}`;
  },

  /****************** RN_FB_DEV ******************/
  [RN_FB_DEV](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

'use strict';

if (__DEV__) {
  (function() {
${source}
  })();
}`;
  },

  /****************** RN_FB_PROD ******************/
  [RN_FB_PROD](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

${source}`;
  },

  /****************** RN_FB_PROFILING ******************/
  [RN_FB_PROFILING](source, globalName, filename, moduleType) {
    return `/**
${license}
 *
 * @noflow
 * @nolint
 * @preventMunge
 * ${'@gen' + 'erated'}
 */

${source}`;
  },
};

const reconcilerWrappers = {
  /***************** NODE_DEV (reconciler only) *****************/
  [NODE_DEV](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */

'use strict';

if (process.env.NODE_ENV !== "production") {
  module.exports = function $$$reconciler($$$hostConfig) {
${source}
    var $$$renderer = module.exports;
    module.exports = $$$reconciler;
    return $$$renderer;
  };
}`;
  },

  /***************** NODE_PROD (reconciler only) *****************/
  [NODE_PROD](source, globalName, filename, moduleType) {
    return `/** @license React v${reactVersion}
 * ${filename}
 *
${license}
 */
module.exports = function $$$reconciler($$$hostConfig) {
${source}
    var $$$renderer = module.exports;
    module.exports = $$$reconciler;
    return $$$renderer;
};`;
  },
};

function wrapBundle(source, bundleType, globalName, filename, moduleType) {
  if (moduleType === RECONCILER) {
    // Standalone reconciler is only used by third-party renderers.
    // It is handled separately.
    const wrapper = reconcilerWrappers[bundleType];
    if (typeof wrapper !== 'function') {
      throw new Error(
        `Unsupported build type for the reconciler package: ${bundleType}.`
      );
    }
    return wrapper(source, globalName, filename, moduleType);
  }
  // All the other packages.
  const wrapper = wrappers[bundleType];
  if (typeof wrapper !== 'function') {
    throw new Error(`Unsupported build type: ${bundleType}.`);
  }
  return wrapper(source, globalName, filename, moduleType);
}

module.exports = {
  wrapBundle,
};
