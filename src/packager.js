/**
 * Thin wrapper around the vendored PenguinMod Packager Node API.
 *
 * The packager is copied into `vendor/pm-packager-dist` by
 * `scripts/build-packager.js`. It is a CommonJS UMD bundle, so it is loaded
 * with a dynamic import and validated before use.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PACKAGE, normalizePackageTarget } from "./config.js";
import {
  applyCustomHtml,
  applyCustomHtmlToArchive,
  slugify,
} from "./package.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "vendor", "pm-packager-dist", "dist");
const ENTRY = path.join(DIST, "packager.js");

let cached = null;

/** Absolute path of the generated packager distribution. */
export function packagerDistPath() {
  return DIST;
}

/**
 * Import the vendored packager, with a useful error when it has not been built.
 * @returns {Promise<{Packager: Function, Image: Function, loadProject: Function}>}
 */
export async function loadPackager() {
  if (cached) return cached;
  if (!fs.existsSync(ENTRY)) {
    throw new Error(
      "The PenguinMod Packager is not built. Run `npm run build:packager` " +
        "from the Triflare Fx checkout (or reinstall the package).",
    );
  }
  const mod = await import(pathToFileURL(ENTRY).href);
  const api = mod.default ?? mod;
  if (
    !api ||
    typeof api.Packager !== "function" ||
    typeof api.loadProject !== "function"
  ) {
    throw new Error(
      `The PenguinMod Packager at ${ENTRY} did not export the expected API.`,
    );
  }
  cached = api;
  return cached;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Merge partial packager options without dropping nested defaults. */
function mergeOptions(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (isPlainObject(value) && isPlainObject(target[key]))
      mergeOptions(target[key], value);
    else target[key] = value;
  }
  return target;
}

/** @param {string} html @param {string} customHtml */
function htmlWithCustomization(html, customHtml) {
  return applyCustomHtml(html, customHtml);
}

/**
 * Package `.pmp` bytes into an HTML file or ZIP archive.
 *
 * @param {object} options
 * @param {Buffer|Uint8Array} options.sb3 Project archive bytes.
 * @param {string} [options.projectName] Used for the window title and package name.
 * @param {ReturnType<import("./package.js").resolvePackageConfig>} [options.packageConfig]
 * @returns {Promise<{
 *   data: Buffer,
 *   type: "text/html"|"application/zip",
 *   filename: string,
 *   target: string,
 *   html: string|null,
 * }>}
 */
export async function packageProject(options = {}) {
  const Packager = await loadPackager();
  const config = options.packageConfig || {
    ...DEFAULT_PACKAGE,
    target: "html",
    custom: { ...DEFAULT_PACKAGE.custom },
    options: {},
  };
  const target = normalizePackageTarget(config.target);
  const displayName = config.name || options.projectName || "Packaged Project";
  const packageName = slugify(displayName);

  const loaded = await Packager.loadProject(
    Buffer.from(options.sb3 ?? []),
    options.onProgress,
  );
  const packager = new Packager.Packager();
  packager.project = loaded;

  mergeOptions(packager.options, config.options || {});
  packager.options.target = target;

  // The packager's defaults already fill in app metadata ("Packaged Project"),
  // so only leave those defaults in place when the user set them explicitly.
  const appOptions = config.options?.app || {};
  packager.options.app ||= {};
  if (appOptions.windowTitle === undefined)
    packager.options.app.windowTitle = displayName;
  if (appOptions.packageName === undefined)
    packager.options.app.packageName = packageName;
  if (appOptions.version === undefined)
    packager.options.app.version = config.version || "1.0.0";

  packager.options.custom ||= {};
  packager.options.custom.js = config.custom?.js || "";
  packager.options.custom.css = config.custom?.css || "";

  if (config.icon) {
    if (path.extname(config.icon).toLowerCase() !== ".png")
      throw new Error(
        `Packager icons must be PNG files; received ${path.basename(config.icon)}`,
      );
    let icon;
    try {
      icon = fs.readFileSync(config.icon);
    } catch (err) {
      throw new Error(
        `Could not read package icon ${config.icon}: ${err.message}`,
        { cause: err },
      );
    }
    packager.options.app.icon = new Packager.Image("image/png", icon);
  }

  if (options.onEvent && typeof packager.addEventListener === "function") {
    for (const [event, listener] of Object.entries(options.onEvent))
      packager.addEventListener(event, listener);
  }

  const result = await packager.package();
  const customHtml = config.custom?.html || "";
  const isHtml = result.type === "text/html";
  let data;
  let html = null;
  let type;

  if (isHtml) {
    html =
      typeof result.data === "string"
        ? result.data
        : Buffer.from(result.data).toString("utf8");
    html = htmlWithCustomization(html, customHtml);
    data = Buffer.from(html);
    type = "text/html";
  } else {
    data = Buffer.from(result.data);
    if (customHtml) data = await applyCustomHtmlToArchive(data, customHtml);
    type = "application/zip";
  }

  return {
    data,
    type,
    filename: result.filename,
    target,
    html,
  };
}
