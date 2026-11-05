/**
 * Triflare Fx public API.
 *
 * @example
 * import {build} from 'fx';
 * const {sb3} = build({file: 'src/player.tfx'});
 * fs.writeFileSync('player.pmp', sb3);
 */
export { tokenize } from "./lexer.js";
export { parse } from "./parser.js";
export { Compiler, compile } from "./compiler.js";
export { build, writeSb3 } from "./build.js";
export { discoverSources, mergePrograms } from "./project.js";
export { decompile, decompileProject } from "./decompiler.js";
export { zipSync, unzipSync, md5hex, imageSize, wavInfo } from "./sb3.js";
export {
  loadExtensions,
  extensionDataUri,
  readExtensionDataUri,
} from "./extensions.js";
export { readSprite, spriteArchive, spriteSource } from "./sprite.js";
export { packageProject, loadPackager, packagerDistPath } from "./packager.js";
export {
  applyCustomHtml,
  extractArchive,
  packageExtension,
  packageOutputPath,
  packageSignature,
  resolvePackageConfig,
  slugify,
} from "./package.js";
export {
  LOCK_FILENAME,
  VendorError,
  defaultVendorName,
  fetchVendorSource,
  formatDiff,
  installVendor,
  installVendorEntry,
  loadVendorExtensions,
  migrateProjectExtensions,
  outdatedVendor,
  readLock,
  removeVendoredExtension,
  resolveVendorFiles,
  sha256,
  uniqueVendorName,
  updateVendor,
  vendorDirPath,
  verifyVendor,
  writeLock,
} from "./vendor.js";
export { formatDevUrls, injectDevClient, startDevServer } from "./dev.js";
export * from "./catalog.js";
export * from "./config.js";
export { FxError, LexError, ParseError, CompileError } from "./errors.js";
