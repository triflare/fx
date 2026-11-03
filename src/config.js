/**
 * `fx.yml` project configuration and PenguinMod config emission.
 *
 * PenguinMod stores per-project runtime settings (framerate, stage size, turbo,
 * interpolation, ...) inside a stage comment whose final line ends with the
 * magic string ` // _twconfig_` followed by JSON. We reproduce that format
 * exactly so the settings round-trip through PenguinMod's own loader. The
 * `_twconfig_` spelling is PenguinMod's on-disk format and must not change.
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { configFilename, configFilenames, productName } from "./brand.js";

export const DEFAULT_PROJECT = {
  name: `${productName()} Project`,
  framerate: 30,
  width: 480,
  height: 360,
  turbo: false,
  interpolation: false,
  hq: false,
  runtime: {},
  extensions: [],
  unsandboxed: [],
};

/**
 * Fx-only settings that never reach PenguinMod's project runtime config.
 * Kept in a separate top-level `fx:` block in fx.yml.
 */
export const DEFAULT_FX = {
  partialSprites: false,
};

/**
 * Packaging defaults. These never reach PenguinMod itself; they are handed to
 * the PenguinMod Packager when `fx package` or `fx dev` runs.
 */
export const DEFAULT_PACKAGE = {
  target: "html",
  output: null,
  extract: false,
  name: null,
  version: null,
  icon: null,
  custom: { js: "", css: "", html: "" },
  options: {},
};

/** Friendly target names mapped onto the packager's environment identifiers. */
export const PACKAGE_TARGET_ALIASES = {
  html: "html",
  zip: "zip",
  "zip-one-asset": "zip-one-asset",
  windows: "electron-win64",
  win: "electron-win64",
  macos: "electron-mac",
  mac: "electron-mac",
  linux: "electron-linux64",
};

/**
 * Top-level packager options we accept directly inside `package:`. Everything
 * else belongs under `package.options`.
 */
const PACKAGE_OPTION_KEYS = new Set([
  "turbo",
  "interpolation",
  "framerate",
  "highQualityPen",
  "maxClones",
  "fencing",
  "miscLimits",
  "dangerousOptimizations",
  "stageWidth",
  "stageHeight",
  "resizeMode",
  "autoplay",
  "username",
  "closeWhenStopped",
  "projectId",
  "appearance",
  "loadingScreen",
  "controls",
  "monitors",
  "penguinmod",
  "compiler",
  "packagedRuntime",
  "optimizeCode",
  "removeDefaultFonts",
  "app",
  "chunks",
  "cloudVariables",
  "cursor",
  "extensions",
  "bakeExtensions",
  "maxTextureDimension",
]);

const PACKAGE_SHORTHANDS = {
  fps: "framerate",
  width: "stageWidth",
  height: "stageHeight",
};

const PACKAGE_SPECIAL_KEYS = new Set([
  "target",
  "output",
  "extract",
  "name",
  "version",
  "icon",
  "custom",
  "options",
]);

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergePlain(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (isPlainObject(value) && isPlainObject(target[key]))
      mergePlain(target[key], value);
    else target[key] = value;
  }
  return target;
}

/** @param {unknown} value @param {string} label */
function normalizeTextSource(value, label) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (isPlainObject(value) && typeof value.file === "string" && value.file)
    return { file: value.file };
  throw new Error(
    `${configFilename()}: ${label} must be text or { file: "<path>" }`,
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePackageTarget(value) {
  if (value == null || value === "") return DEFAULT_PACKAGE.target;
  if (typeof value !== "string")
    throw new Error(`${configFilename()}: package.target must be a string`);
  const key = value.toLowerCase();
  return PACKAGE_TARGET_ALIASES[key] ?? key;
}

/**
 * @param {object} raw parsed YAML `package` mapping
 * @returns {typeof DEFAULT_PACKAGE}
 */
export function normalizePackage(raw = {}) {
  if (!isPlainObject(raw))
    throw new Error(`${configFilename()}: "package" must be a mapping`);

  const unknown = Object.keys(raw).filter(
    (key) =>
      !PACKAGE_SPECIAL_KEYS.has(key) &&
      !PACKAGE_OPTION_KEYS.has(key) &&
      !Object.hasOwn(PACKAGE_SHORTHANDS, key),
  );
  if (unknown.length)
    throw new Error(
      `${configFilename()}: unknown package setting(s): ${unknown
        .map((key) => `"${key}"`)
        .join(", ")}. Put raw packager options under "package.options".`,
    );

  const pkg = {
    ...DEFAULT_PACKAGE,
    custom: { ...DEFAULT_PACKAGE.custom },
    options: {},
  };
  pkg.target = normalizePackageTarget(raw.target);
  if (raw.output != null) pkg.output = String(raw.output);
  if (raw.extract != null) pkg.extract = Boolean(raw.extract);
  if (raw.name != null) pkg.name = String(raw.name);
  if (raw.version != null) pkg.version = String(raw.version);
  if (raw.icon != null) {
    if (typeof raw.icon === "string" && raw.icon) pkg.icon = raw.icon;
    else if (isPlainObject(raw.icon) && typeof raw.icon.file === "string")
      pkg.icon = raw.icon.file;
    else
      throw new Error(
        `${configFilename()}: package.icon must be a file path or { file: "<path>" }`,
      );
  }

  if (raw.custom != null) {
    if (!isPlainObject(raw.custom))
      throw new Error(
        `${configFilename()}: "package.custom" must be a mapping`,
      );
    const unknownCustom = Object.keys(raw.custom).filter(
      (key) => !["js", "css", "html"].includes(key),
    );
    if (unknownCustom.length)
      throw new Error(
        `${configFilename()}: unknown package.custom setting(s): ${unknownCustom
          .map((key) => `"${key}"`)
          .join(", ")}`,
      );
    for (const key of ["js", "css", "html"])
      pkg.custom[key] = normalizeTextSource(
        raw.custom[key],
        `package.custom.${key}`,
      );
  }

  for (const [key, option] of Object.entries(PACKAGE_SHORTHANDS)) {
    if (raw[key] !== undefined) pkg.options[option] = raw[key];
  }
  for (const key of PACKAGE_OPTION_KEYS) {
    if (raw[key] === undefined) continue;
    if (isPlainObject(raw[key]) && isPlainObject(pkg.options[key]))
      mergePlain(pkg.options[key], raw[key]);
    else pkg.options[key] = raw[key];
  }
  if (raw.options != null) {
    if (!isPlainObject(raw.options))
      throw new Error(
        `${configFilename()}: "package.options" must be a mapping`,
      );
    mergePlain(pkg.options, raw.options);
  }

  return pkg;
}

/** PenguinMod's stage-comment magic string (unchanged on disk). */
export const CONFIG_MAGIC = " // _twconfig_";

const COMMENT_PREAMBLE =
  "Configuration for https://penguinmod.com/\n" +
  "You can move, resize, and minimize this comment, but don't edit it by hand. " +
  "This comment can be deleted to remove the stored settings.";

/**
 * @param {object} raw parsed YAML `project` mapping
 * @returns {typeof DEFAULT_PROJECT}
 */
export function normalizeProject(raw = {}) {
  const project = { ...DEFAULT_PROJECT };

  if (raw.name != null) project.name = String(raw.name);
  if (raw.fps != null) project.framerate = Number(raw.fps);
  else if (raw.framerate != null) project.framerate = Number(raw.framerate);
  if (raw.width != null) project.width = Number(raw.width);
  if (raw.height != null) project.height = Number(raw.height);
  if (raw.turbo != null) project.turbo = Boolean(raw.turbo);
  if (raw.interpolation != null)
    project.interpolation = Boolean(raw.interpolation);
  else if (raw.interpolate != null)
    project.interpolation = Boolean(raw.interpolate);
  if (raw.hq != null || raw.hqPen != null)
    project.hq = Boolean(raw.hq ?? raw.hqPen);
  if (raw.runtime && typeof raw.runtime === "object")
    project.runtime = raw.runtime;
  if (Array.isArray(raw.extensions))
    project.extensions = raw.extensions.map(String);
  if (Array.isArray(raw.unsandboxed))
    project.unsandboxed = raw.unsandboxed.map(String);
  else if (raw.unsandboxed != null)
    project.unsandboxed = [String(raw.unsandboxed)];

  return project;
}

/**
 * @param {object} raw parsed YAML `fx` mapping
 * @returns {typeof DEFAULT_FX}
 */
export function normalizeFx(raw = {}) {
  const fx = { ...DEFAULT_FX };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.partialSprites != null)
      fx.partialSprites = Boolean(raw.partialSprites);
  }
  return fx;
}

/**
 * Parse a YAML config string.
 * @param {string} text
 * @returns {{project: typeof DEFAULT_PROJECT, fx: typeof DEFAULT_FX, raw: object}}
 */
export function parseConfig(text) {
  const raw = yaml.load(text) || {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      `${configFilename()} must contain a mapping at the top level`,
    );
  if (raw.fx != null && (typeof raw.fx !== "object" || Array.isArray(raw.fx)))
    throw new Error(`${configFilename()} must contain an "fx" mapping`);
  return {
    project: normalizeProject(raw.project || {}),
    fx: normalizeFx(raw.fx || {}),
    package: normalizePackage(raw.package || {}),
    raw,
  };
}

/**
 * Find the nearest `fx.yml`/`fx.yaml`, walking up from `dir`.
 * This lets a project keep its config at the repository root while sources
 * live in `src/`.
 * @param {string} dir
 * @returns {string|null}
 */
export function findConfigPath(dir) {
  let current = path.resolve(dir);
  for (;;) {
    for (const name of configFilenames()) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Find and load `fx.yml`/`fx.yaml` from a directory (or any of
 * its ancestors).
 * @param {string} dir
 * @returns {{project: typeof DEFAULT_PROJECT, fx: typeof DEFAULT_FX, package: typeof DEFAULT_PACKAGE, raw: object, path: string|null}}
 */
export function loadConfigFrom(dir) {
  const found = findConfigPath(dir);
  if (found) {
    const {
      project,
      fx,
      package: pkg,
      raw,
    } = parseConfig(fs.readFileSync(found, "utf8"));
    return { project, fx, package: pkg, raw, path: found };
  }
  return {
    project: { ...DEFAULT_PROJECT },
    fx: { ...DEFAULT_FX },
    package: normalizePackage({}),
    raw: {},
    path: null,
  };
}

/**
 * Build the differing-from-default config payload. Matches the shape produced
 * by PenguinMod's `runtime.storeProjectOptions()`.
 * @param {typeof DEFAULT_PROJECT} project
 * @returns {object}
 */
export function configPayload(project) {
  const out = {};
  if (project.framerate && project.framerate !== DEFAULT_PROJECT.framerate)
    out.framerate = project.framerate;
  if (project.turbo) out.turbo = true;
  if (project.interpolation) out.interpolation = true;
  if (project.hq) out.hq = true;
  if (project.width && project.width !== DEFAULT_PROJECT.width)
    out.width = project.width;
  if (project.height && project.height !== DEFAULT_PROJECT.height)
    out.height = project.height;

  const defaultRuntime = { maxClones: 300, miscLimits: true, fencing: true };
  const runtime = {};
  for (const [key, value] of Object.entries(project.runtime || {})) {
    if (value !== defaultRuntime[key]) runtime[key] = value;
  }
  if (Object.keys(runtime).length) out.runtimeOptions = runtime;

  return out;
}

/**
 * Full text for the stage config comment, or null when everything is at its
 * default.
 * @param {typeof DEFAULT_PROJECT} project
 * @returns {string|null}
 */
export function configComment(project) {
  const payload = configPayload(project);
  if (Object.keys(payload).length === 0) return null;
  return `${COMMENT_PREAMBLE}\n${JSON.stringify(payload)}${CONFIG_MAGIC}`;
}

export {
  addProjectExtension,
  extensionKey,
  readProjectExtensions,
  removeProjectExtension,
} from "./config-edit.js";
