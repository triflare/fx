/**
 * Packaging helpers shared by `fx package`, `fx dev`, and the public API.
 *
 * `fx.yml` values can be inline text or a `{ file: "..." }` reference. File
 * references are resolved here, relative to the directory that contains
 * `fx.yml`, before the packager sees them.
 */
import fs from "node:fs";
import path from "node:path";
import { outputDirectory } from "./brand.js";
import { DEFAULT_PACKAGE, normalizePackageTarget } from "./config.js";

/** Turn a project name into a filesystem-friendly slug. */
export function slugify(name) {
  return (
    String(name || "project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** @param {unknown} value @param {string} label @param {string} baseDir */
function readTextSource(value, label, baseDir) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.file === "string") {
    const file = path.resolve(baseDir, value.file);
    try {
      return fs.readFileSync(file, "utf8");
    } catch (err) {
      throw new Error(`Could not read ${label} from ${file}: ${err.message}`, {
        cause: err,
      });
    }
  }
  throw new Error(`${label} must be text or { file: "<path>" }`);
}

/**
 * Resolve file-backed values and paths in a normalized `package:` block.
 *
 * @param {typeof DEFAULT_PACKAGE} [pkg]
 * @param {{baseDir?: string, projectName?: string}} [options]
 * @returns {{
 *   target: string,
 *   output: string|null,
 *   extract: boolean,
 *   name: string|null,
 *   version: string|null,
 *   icon: string|null,
 *   custom: {js: string, css: string, html: string},
 *   options: object,
 *   baseDir: string,
 * }}
 */
export function resolvePackageConfig(pkg = DEFAULT_PACKAGE, options = {}) {
  const baseDir = path.resolve(options.baseDir || process.cwd());
  const projectName = options.projectName || null;
  return {
    target: normalizePackageTarget(pkg.target),
    output: pkg.output ? path.resolve(baseDir, pkg.output) : null,
    extract: Boolean(pkg.extract),
    name: pkg.name || projectName || null,
    version: pkg.version || null,
    icon: pkg.icon ? path.resolve(baseDir, pkg.icon) : null,
    custom: {
      js: readTextSource(pkg.custom?.js, "package.custom.js", baseDir),
      css: readTextSource(pkg.custom?.css, "package.custom.css", baseDir),
      html: readTextSource(pkg.custom?.html, "package.custom.html", baseDir),
    },
    options: pkg.options || {},
    baseDir,
  };
}

/** Whether a target produces an HTML file rather than a ZIP archive. */
export function isHtmlTarget(target) {
  return normalizePackageTarget(target) === "html";
}

/** File extension for a packager target. */
export function packageExtension(target) {
  return isHtmlTarget(target) ? ".html" : ".zip";
}

/**
 * Pick an output path. A directory (existing, or ending in a slash) gets the
 * default filename appended; an extensionless path gets the target extension.
 *
 * @param {{target: string, output?: string|null, name?: string|null, dir?: string}} options
 * @returns {string}
 */
export function packageOutputPath(options) {
  const dir = path.resolve(options.dir || process.cwd());
  const extension = packageExtension(options.target);
  const filename = `${slugify(options.name)}${extension}`;
  if (!options.output) return path.join(dir, outputDirectory(), filename);

  const requested = path.resolve(dir, String(options.output));
  let isDirectory;
  try {
    isDirectory = fs.statSync(requested).isDirectory();
  } catch {
    isDirectory = /[\\/]$/.test(String(options.output));
  }
  if (isDirectory) return path.join(requested, filename);
  if (!path.extname(requested)) return `${requested}${extension}`;
  return requested;
}

/** A stable signature of resolved package settings, for dev rebuilds. */
export function packageSignature(pkg) {
  let signature = JSON.stringify(pkg);
  if (pkg.icon) {
    try {
      const stat = fs.statSync(pkg.icon);
      signature += `:icon:${stat.size}:${stat.mtimeMs}`;
    } catch {
      // The packager will report the missing icon with a better message.
    }
  }
  return signature;
}

/**
 * Insert custom HTML just before the closing body tag. If a document has no
 * body tag (for example a fragment), append it instead.
 *
 * @param {string} html
 * @param {string} customHtml
 * @returns {string}
 */
export function applyCustomHtml(html, customHtml) {
  if (!customHtml) return html;
  const block = `<!-- fx: custom html -->\n${customHtml}\n`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${block}</body>`);
  }
  return `${html}${html.endsWith("\n") ? "" : "\n"}${block}`;
}

/**
 * Apply custom HTML inside a packaged ZIP archive by replacing its index.html.
 * The packager has no native HTML hook, so this is how desktop and zip targets
 * get the same custom HTML as the plain HTML target.
 *
 * @param {Buffer|Uint8Array} data
 * @param {string} customHtml
 * @returns {Promise<Buffer>}
 */
export async function applyCustomHtmlToArchive(data, customHtml) {
  if (!customHtml) return Buffer.from(data);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const index = zip.file("index.html");
  if (!index) throw new Error("Packaged archive is missing index.html");
  const html = await index.async("string");
  zip.file("index.html", applyCustomHtml(html, customHtml), {
    date: index.date,
    unixPermissions: index.unixPermissions,
  });
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
}

/**
 * Extract a packaged ZIP to a directory, preserving unix execute bits (which
 * desktop builds need for their launchers).
 *
 * @param {Buffer|Uint8Array} data
 * @param {string} destination
 * @returns {Promise<string[]>} written file names
 */
export async function extractArchive(data, destination) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const root = path.resolve(destination);
  const written = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`Refusing to extract unsafe path: ${name}`);
    if (entry.dir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async("nodebuffer"));
    if (entry.unixPermissions)
      fs.chmodSync(target, entry.unixPermissions & 0o777);
    written.push(name);
  }

  return written;
}
