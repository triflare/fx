/**
 * Webpack entry for the vendored PenguinMod VM build.
 *
 * Everything is imported from one compilation so that `centralDispatch` is the
 * same singleton the VM itself uses. `Cast`, `Color`, and the extension API
 * are exported for the tests that check the sandbox shims against the real VM.
 */
const VirtualMachine = require("../vendor/pm-vm/src/index.js");
const centralDispatch = require("../vendor/pm-vm/src/dispatch/central-dispatch.js");
const extensionApi = require("../vendor/pm-vm/src/extension-support/tw-extension-api-common.js");
const Cast = require("../vendor/pm-vm/src/util/cast.js");
const Color = require("../vendor/pm-vm/src/util/color.js");

module.exports = {
  VirtualMachine,
  centralDispatch,
  extensionApi,
  Cast,
  Color,
};
