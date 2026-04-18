// Shim: redirect libsodium-wrappers-sumo to its CJS entry for test environments.
// The ESM entry (libsodium-sumo.mjs) is missing from the npm package.
// We use an absolute path to bypass the package's exports field restrictions.
'use strict';
const path = require('node:path');
const cjsEntry = path.resolve(
  __dirname,
  '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'
);
module.exports = require(cjsEntry);
