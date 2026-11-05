#!/usr/bin/env node
/**
 * Triflare Fx command line interface.
 *
 *   fx build [input.tfx | dir] [-o out.pmp] [--no-config]   (alias: b)
 *   fx decompile <input.pmp> [-o out.tfx] [--assets <dir>] [--fetch-extensions]
 *                                                          (alias: d)
 *   fx check [input.tfx | dir]                              (alias: c)
 *   fx catalog [dir] [--json]                              (alias: l)
 *   fx init [dir]                                          (alias: i)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { build } from "../src/build.js";
import { parse } from "../src/parser.js";
import { discoverSources, mergePrograms } from "../src/project.js";
import { decompileProject } from "../src/decompiler.js";
import { unzipSync } from "../src/sb3.js";
import { CATALOG, blockNames } from "../src/catalog.js";
import {
  addProjectExtension,
  findConfigPath,
  loadConfigFrom,
  normalizePackageTarget,
  readProjectExtensions,
  removeProjectExtension,
} from "../src/config.js";
import { loadExtensions, readExtensionDataUri } from "../src/extensions.js";
import {
  LOCK_FILENAME,
  defaultVendorName,
  installVendor,
  installVendorEntry,
  loadVendorExtensions,
  migrateProjectExtensions,
  outdatedVendor,
  readLock,
  removeVendoredExtension,
  resolveVendorFiles,
  updateVendor,
  verifyVendor,
} from "../src/vendor.js";
import { readSprite, spriteArchive, spriteSource } from "../src/sprite.js";
import { packageProject } from "../src/packager.js";
import {
  extractArchive,
  packageOutputPath,
  packageSignature,
  resolvePackageConfig,
  slugify,
} from "../src/package.js";
import { startDevServer } from "../src/dev.js";
import {
  brandText,
  configFilename,
  configFilenames,
  outputDirectory,
  sourceDirectory,
  sourceExtension,
} from "../src/brand.js";
import { createLogger } from "../src/log.js";
import { loadProduct } from "../src/product.js";

const product = loadProduct();
const log = createLogger(product);
const EXTENSION = sourceExtension(product);

function parseArgs(argv, command) {
  const args = { _: [], flags: {} };
  const booleanFlags = new Set([
    "no-config",
    "json",
    "help",
    "h",
    "version",
    "v",
    "force",
    "extract",
    "lan",
    "strict-port",
    "fetch-extensions",
    "no-upgrade-prompt",
    "yes",
    "all",
    "dry-run",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      // `extension add --unsandboxed <id>` takes a value, while
      // `vendor install --unsandboxed` is a plain switch.
      const boolean =
        booleanFlags.has(key) ||
        (key === "unsandboxed" && command === "vendor");
      if (inline !== undefined) args.flags[key] = inline;
      else if (boolean) args.flags[key] = true;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-"))
        args.flags[key] = argv[++i];
      else args.flags[key] = true;
    } else if (token.startsWith("-")) {
      const key = token.slice(1);
      if (booleanFlags.has(key)) args.flags[key] = true;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-"))
        args.flags[key] = argv[++i];
      else args.flags[key] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function usage(stream = process.stdout) {
  const command = brandText(product.command, stream);
  const name = brandText(product.name, stream);
  return `${name} ${product.version} — ${product.tagline}

Usage:
  ${command} build [<input${EXTENSION}>|<dir>] [-o <output.pmp>] [--no-config]
  ${command} package [<input${EXTENSION}>|<input.pmp>|<dir>] [-o <output>] [--target <target>] [--extract]
  ${command} dev [<input${EXTENSION}>|<dir>] [--host [host]] [--lan] [--port <port>] [--strict-port]
  ${command} decompile <input.pmp> [-o <output${EXTENSION}>] [--assets <dir>] [--fetch-extensions]
  ${command} check [<input${EXTENSION}>|<dir>]
  ${command} catalog [<dir>] [--json]
  ${command} init [dir]
  ${command} vendor install [<url|path>] [--as <name>] [--unsandboxed]
  ${command} vendor update [<name>] [--dry-run]
  ${command} vendor outdated
  ${command} vendor verify
  ${command} vendor remove <name>
  ${command} vendor list [--json]
  ${command} vendor migrate [--yes]

Commands:
  build     (b)  Compile a source file, or every ${EXTENSION} file in a directory
                 (defaults to the working directory) into one .pmp.
  package   (p)  Package a source, project archive or directory into HTML or a ZIP
                 (Windows/macOS/Linux desktop builds use Electron).
  dev            Serve the packaged HTML and reload when the output changes.
  decompile (d)  Convert a .pmp back into ${product.name} source, restoring
                 extensions into ${configFilename(product)}.
  check     (c)  Parse a file (or every ${EXTENSION} file in a directory) for errors.
  catalog   (l)  List ${product.name} blocks, including those from ${configFilename(product)}
                 extensions (paths or URLs).
  init      (i)  Scaffold a new project.
  vendor         Copy extensions into ${configFilename(product)}/fx.lock and load them
                 from the vendor directory (default: extensions/).

Command groups:
  extension add <source> [--unsandboxed <id>]
                 Add a legacy extension (path or URL) to ${configFilename(product)}.
  extension remove <source|id>
                 Remove an extension from ${configFilename(product)}.
  extension list [--json]
                 List configured extensions.
  vendor install [<source>] [--as <name>] [--unsandboxed]
                 Vendor one extension, or restore every entry in ${configFilename(product)}
                 from fx.lock (fetching only missing files).
  vendor update [<name>] [--dry-run]
                 Re-fetch, update the vendored copy and show the diff
                 (use --dry-run to preview without writing).
  vendor outdated
                 Compare upstream sources with fx.lock.
  vendor verify  Check vendored files against fx.lock without the network.
  vendor remove <name>
                 Remove a vendored extension from ${configFilename(product)}, fx.lock and disk.
  vendor list [--json]
                 List vendored extensions.
  vendor migrate Move project.extensions into the vendor system (writes .bak).
  sprite add <url|file> [--name <name>] [--force]
                 Import a .sprite3/.pms sprite as .tfx source.
  sprite build <name> [-o <output.pms>]
                 Compile one sprite into a .pms archive.
  sprite remove <name>
                 Delete a source file that declares only that sprite.
  sprite list [<dir>] [--json]
                 List declared sprites.

Options:
  -o, --output    Output file path
  --no-config     Ignore ${configFilename(product)}
  --assets <dir>  Extract project assets into <dir> when decompiling
  --fetch-extensions  Load remote (http/https) extensions when decompiling
  --target <t>    Packaging target (html, zip, windows, macos, linux, …)
  --extract       Unzip a packaged desktop/zip archive
  --host [host]   Dev server host; with no value listen on all interfaces
  --lan           Alias for listening on all interfaces
  --port <port>   Dev server port (default 3000)
  --strict-port   Fail instead of picking the next free dev port
  --json          Machine readable output (catalog)
  --as <name>     Name for a vendored extension
  --unsandboxed   Mark a vendored extension as requiring unsandboxed mode
  --dry-run       Show vendor update diffs without writing files
  --yes           Accept the migration prompt
  --no-upgrade-prompt  Do not offer to migrate project.extensions
  -v, --version   Print the version
`;
}

/** Long command name -> one-letter alias. */
const COMMAND_ALIASES = {
  b: "build",
  p: "package",
  d: "decompile",
  c: "check",
  l: "catalog",
  i: "init",
};

function fail(message) {
  log.error(message);
  process.exit(1);
}

const CI_VARS = ["CI", "GITHUB_ACTIONS", "TRAVIS", "JENKINS_URL", "CIRCLECI"];

/** True when a real interactive prompt is safe (TTY, not CI, not disabled). */
function canPrompt(flags = {}) {
  return (
    Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
    !flags["no-upgrade-prompt"] &&
    process.env.FX_NO_PROMPT !== "1" &&
    !CI_VARS.some((name) => process.env[name])
  );
}

/** Ask a yes/no question, defaulting to yes on an empty answer. */
async function askYesNo(question, { yes = false } = {}) {
  if (yes) return true;
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** Ask for an editable name, falling back on an empty answer. */
async function askName(question, fallback) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

let legacyWarningShown = false;
let migrationDeclined = false;
/** Warn once per process that project.extensions is deprecated. */
function warnLegacyExtensions(config) {
  if (legacyWarningShown) return;
  if (!config || !config.extensions || config.extensions.length === 0) return;
  legacyWarningShown = true;
  log.warn(
    `project.extensions is deprecated and will be removed in ${product.name} 2.0; ` +
      `run "${product.command} vendor migrate" to move extensions into vendor:`,
  );
}

/**
 * Load fx.yml and offer to migrate legacy project.extensions. Prompting only
 * happens with a TTY; CI and redirected commands keep the legacy behavior.
 */
async function loadProjectConfiguration(
  searchDir,
  flags = {},
  { prompt = true } = {},
) {
  if (flags["no-config"])
    return {
      project: null,
      fx: null,
      package: null,
      vendor: [],
      vendorDir: "extensions",
      path: null,
    };

  let loaded = loadConfigFrom(searchDir);
  if (!loaded.path || loaded.project.extensions.length === 0) return loaded;

  warnLegacyExtensions(loaded.project);
  if (!prompt || migrationDeclined) return loaded;
  const autoAccept =
    Boolean(flags.yes) &&
    !flags["no-upgrade-prompt"] &&
    process.env.FX_NO_PROMPT !== "1";
  if (!canPrompt(flags) && !autoAccept) return loaded;

  const upgrade =
    autoAccept ||
    (await askYesNo(`Upgrade project.extensions to the vendor system? [Y/n] `, {
      yes: false,
    }));
  if (!upgrade) {
    migrationDeclined = true;
    return loaded;
  }

  const configDir = path.dirname(loaded.path);
  try {
    const result = await migrateProjectExtensions({
      configPath: loaded.path,
      configDir,
      config: loaded,
      nameFor: flags.yes
        ? undefined
        : (name, source) => askName(`Name for ${source}`, name),
    });
    for (const warning of result.warnings)
      process.stderr.write(`warning: ${warning}\n`);
    if (result.diff) process.stdout.write(result.diff);
    if (result.migrated.length > 0)
      log.success(
        `Vendored ${result.migrated.length} extension(s); backup: ${path.relative(
          process.cwd(),
          result.backup,
        )}`,
      );
    loaded = loadConfigFrom(searchDir);
  } catch (error) {
    migrationDeclined = true;
    log.warn(`Could not migrate project.extensions: ${error.message}`);
  }
  return loaded;
}

/** Load vendored and legacy extensions and combine their warnings. */
async function loadProjectExtensions(configDir, loaded) {
  const catalog = {};
  const extensionUrls = {};
  const unsandboxed = [];
  const config = loaded?.project || {};
  const matchedUnsandboxed = new Set();
  const unnecessaryUnsandboxed = new Set();

  if (loaded?.vendor && loaded.vendor.length > 0) {
    const vendored = await loadVendorExtensions({ configDir, config: loaded });
    Object.assign(catalog, vendored.catalog);
    Object.assign(extensionUrls, vendored.extensionUrls);
    unsandboxed.push(...vendored.unsandboxed);
    for (const name of vendored.matchedUnsandboxed || [])
      matchedUnsandboxed.add(name);
    for (const name of vendored.unnecessaryUnsandboxed || [])
      unnecessaryUnsandboxed.add(name);
    for (const warning of vendored.warnings)
      process.stderr.write(`warning: ${warning}\n`);
  }

  if (config.extensions && config.extensions.length > 0) {
    warnLegacyExtensions(config);
    const legacy = await loadExtensions(config.extensions, {
      baseDir: configDir,
      expectUnsandboxed: config.unsandboxed,
      reportUnmatchedUnsandboxed: false,
    });
    Object.assign(catalog, legacy.catalog);
    Object.assign(extensionUrls, legacy.extensionUrls);
    unsandboxed.push(...legacy.unsandboxed);
    for (const name of legacy.matchedUnsandboxed || [])
      matchedUnsandboxed.add(name);
    for (const name of legacy.unnecessaryUnsandboxed || [])
      unnecessaryUnsandboxed.add(name);
    for (const warning of legacy.warnings)
      process.stderr.write(`warning: ${warning}\n`);
  }

  for (const name of new Set(config.unsandboxed || [])) {
    if (unnecessaryUnsandboxed.has(name)) {
      process.stderr.write(
        `warning: project.unsandboxed entry "${name}" loads in the sandbox; remove it from fx.yml\n`,
      );
    } else if (!matchedUnsandboxed.has(name)) {
      process.stderr.write(
        `warning: project.unsandboxed entry "${name}" does not match any loaded extension\n`,
      );
    }
  }

  return { catalog, extensionUrls, unsandboxed };
}

/** Split a positional build/check argument into `{file}` or `{dir}`. */
function resolveInput(input) {
  if (!input) return { dir: process.cwd() };
  const resolved = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(`input not found: ${input}`);
  }
  return stat.isDirectory() ? { dir: resolved } : { file: resolved };
}

/** Compile project sources into a .pmp archive. */
async function cmdBuild(args) {
  const target = resolveInput(args._[0]);
  const searchDir = target.file ? path.dirname(target.file) : target.dir;

  const loaded = await loadProjectConfiguration(searchDir, args.flags);
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : searchDir;
  const { catalog, extensionUrls, unsandboxed } = await loadProjectExtensions(
    extBase,
    loaded,
  );

  const result = build({
    ...target,
    projectConfig: config,
    fxConfig: loaded.fx,
    catalog,
    extensionUrls,
    useConfigFile: !args.flags["no-config"],
  });
  for (const warning of result.warnings)
    process.stderr.write(`warning: ${warning}\n`);

  const explicit = args.flags.o || args.flags.output;
  const output =
    explicit ||
    (target.file
      ? target.file.toLowerCase().endsWith(EXTENSION.toLowerCase())
        ? `${target.file.slice(0, -EXTENSION.length)}.pmp`
        : `${target.file}.pmp`
      : path.join(
          target.dir,
          outputDirectory(product),
          `${slugify(result.config.name || path.basename(target.dir))}.pmp`,
        ));

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, result.sb3);

  const blockCount = result.project.targets.reduce(
    (sum, t) => sum + Object.keys(t.blocks).length,
    0,
  );
  log.success(`Built ${output}`);
  process.stdout.write(
    `  sources:    ${result.files.length} file(s)\n` +
      `  targets:    ${result.project.targets.length}\n` +
      `  blocks:     ${blockCount}\n` +
      `  assets:     ${result.assets.size}\n` +
      `  extensions: ${result.project.extensions.join(", ") || "(none)"}\n` +
      (unsandboxed.length
        ? `  unsandboxed: ${unsandboxed.join(", ")} ` +
          "(must be allowed to run unsandboxed in the editor)\n"
        : ""),
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

/** Read a `.pmp` directly, or build `.tfx`/directory sources into one. */
/** Read a .pmp or build sources for the packaging commands. */
async function readPackagingSource(target, loaded) {
  const searchDir = target.file ? path.dirname(target.file) : target.dir;
  if (target.file && path.extname(target.file).toLowerCase() === ".pmp") {
    return {
      sb3: fs.readFileSync(target.file),
      projectName: path.basename(target.file, path.extname(target.file)),
      searchDir,
    };
  }

  const extBase = loaded.path ? path.dirname(loaded.path) : searchDir;
  const { catalog, extensionUrls } = await loadProjectExtensions(
    extBase,
    loaded,
  );
  const result = build({
    ...target,
    projectConfig: loaded.project,
    fxConfig: loaded.fx,
    catalog,
    extensionUrls,
    useConfigFile: false,
  });
  return {
    sb3: result.sb3,
    projectName: result.config.name,
    searchDir,
  };
}

/** Package a project into HTML, ZIP or a desktop target. */
async function cmdPackage(args) {
  const target = resolveInput(args._[0]);
  const loaded = await loadProjectConfiguration(
    target.file ? path.dirname(target.file) : target.dir,
    args.flags,
  );
  const source = await readPackagingSource(target, loaded);
  const baseDir = loaded.path ? path.dirname(loaded.path) : source.searchDir;
  const pkg = resolvePackageConfig(loaded.package, {
    baseDir,
    projectName: source.projectName,
  });

  if (args.flags.target !== undefined) {
    if (typeof args.flags.target !== "string") fail("--target needs a value");
    pkg.target = normalizePackageTarget(args.flags.target);
  }
  const explicit = args.flags.o || args.flags.output;
  if (explicit !== undefined) {
    if (typeof explicit !== "string") fail("-o/--output needs a value");
    pkg.output = path.resolve(explicit);
  }
  const extract = Boolean(args.flags.extract) || pkg.extract;
  if (extract && pkg.target === "html")
    fail("--extract only applies to zip and desktop targets");

  const output = packageOutputPath({
    target: pkg.target,
    output: pkg.output,
    name: pkg.name || source.projectName,
    dir: baseDir,
  });
  const result = await packageProject({
    sb3: source.sb3,
    projectName: source.projectName,
    packageConfig: pkg,
  });

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, result.data);
  log.success(`Packaged ${output}`);
  process.stdout.write(
    `  target:     ${result.target}\n` +
      `  type:       ${result.type}\n` +
      `  size:       ${formatBytes(result.data.length)}\n`,
  );

  if (extract) {
    const extension = path.extname(output);
    const extractDir = path.join(
      path.dirname(output),
      path.basename(output, extension),
    );
    const files = await extractArchive(result.data, extractDir);
    log.success(`Extracted ${files.length} file(s) to ${extractDir}`);
  }
}

/** Run the live-reloading development server. */
async function cmdDev(args) {
  const target = resolveInput(args._[0]);
  if (target.file && path.extname(target.file).toLowerCase() === ".pmp")
    fail("fx dev needs .tfx sources or a directory, not a .pmp archive");

  const searchDir = target.file ? path.dirname(target.file) : target.dir;
  const useConfigFile = !args.flags["no-config"];
  const configPath = useConfigFile ? findConfigPath(searchDir) : null;
  const baseDir = configPath ? path.dirname(configPath) : searchDir;

  let host = "127.0.0.1";
  if (args.flags.lan) host = "0.0.0.0";
  else if (args.flags.host === true) host = "0.0.0.0";
  else if (typeof args.flags.host === "string") host = args.flags.host;

  if (args.flags.port === true) fail("--port needs a number");
  const port = args.flags.port === undefined ? 3000 : Number(args.flags.port);

  let lastSb3Hash = null;
  let lastSignature = null;
  let lastHtml = null;

  const buildForDev = async () => {
    const loaded = useConfigFile
      ? await loadProjectConfiguration(searchDir, args.flags)
      : {
          project: null,
          fx: null,
          package: null,
          vendor: [],
          vendorDir: "extensions",
          path: null,
        };
    const configBase = loaded.path ? path.dirname(loaded.path) : searchDir;
    const { catalog, extensionUrls } = await loadProjectExtensions(
      configBase,
      loaded,
    );
    const result = build({
      ...target,
      projectConfig: loaded.project,
      fxConfig: loaded.fx,
      catalog,
      extensionUrls,
      useConfigFile: false,
    });
    const pkg = resolvePackageConfig(loaded.package, {
      baseDir: configBase,
      projectName: result.config.name,
    });
    // Dev always serves HTML, no matter what the package block requests.
    pkg.target = "html";

    const signature = packageSignature(pkg);
    const sb3Hash = crypto
      .createHash("sha256")
      .update(result.sb3)
      .digest("hex");
    if (
      lastHtml != null &&
      sb3Hash === lastSb3Hash &&
      signature === lastSignature
    )
      return lastHtml;

    const packaged = await packageProject({
      sb3: result.sb3,
      projectName: result.config.name,
      packageConfig: pkg,
    });
    lastSb3Hash = sb3Hash;
    lastSignature = signature;
    lastHtml = packaged.html ?? packaged.data.toString("utf8");
    return lastHtml;
  };

  const server = await startDevServer({
    watchDir: baseDir,
    build: buildForDev,
    host,
    port,
    strictPort: Boolean(args.flags["strict-port"]),
    log,
  });

  process.stdout.write(`\n  ${brandText(product.name)} dev\n`);
  for (const url of server.localUrls) log.bullet(`Local:   ${url}`);
  for (const url of server.networkUrls) log.bullet(`Network: ${url}`);
  log.info("  Press Ctrl+C to stop.");

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.ready;
}

/** Parse project sources without writing an archive. */
function cmdCheck(args) {
  const target = resolveInput(args._[0]);
  const files = target.file ? [target.file] : discoverSources(target.dir);
  if (files.length === 0)
    fail(`No ${EXTENSION} files found under ${target.dir}`);

  const searchDir = target.file ? path.dirname(target.file) : target.dir;
  const loaded = args.flags["no-config"]
    ? { fx: null }
    : loadConfigFrom(searchDir);
  const entries = files.map((file) => ({
    ast: parse(fs.readFileSync(file, "utf8"), file),
    file,
  }));
  mergePrograms(entries, {
    partialSprites: loaded.fx?.partialSprites ?? false,
  });
  log.success(`Checked ${files.length} file(s): OK`);
}

/** List built-in and project extension blocks. */
async function cmdCatalog(args) {
  // Merge the built-in catalog with any extensions declared in fx.yml, so
  // blocks from path- or URL-loaded extensions show up here too.
  const loaded = await loadProjectConfiguration(
    args._[0] || process.cwd(),
    args.flags,
    { prompt: !args.flags.json },
  );
  const extBase = loaded.path ? path.dirname(loaded.path) : process.cwd();
  const { catalog } = await loadProjectExtensions(extBase, loaded);

  const merged = { ...CATALOG, ...catalog };
  const names = Object.keys(merged).sort();

  if (args.flags.json) {
    process.stdout.write(`${JSON.stringify(merged, null, 2)}\n`);
    return;
  }
  const builtIn = blockNames().length;
  process.stdout.write(
    `${product.name} catalog (${names.length} blocks` +
      (names.length > builtIn
        ? `, ${names.length - builtIn} from extensions`
        : "") +
      `):\n`,
  );
  for (const name of names) {
    const entry = merged[name];
    const tag = entry.extension ? ` (ext ${entry.extension})` : "";
    process.stdout.write(
      `  ${name.padEnd(32)} -> ${entry.opcode} [${entry.kind}]${tag}\n`,
    );
  }
}

function truncate(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Sanitize an extension id into a portable file name stem. */
function extensionFileStem(id) {
  return (
    String(id)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "extension"
  );
}

/**
 * Recover the extensions a decompiled project references.
 *
 * An archive only remembers extension sources through `project.extensionURLs`:
 * Triflare Fx stores local extension files there as data URIs, and PenguinMod
 * projects keep plain URLs. Data URIs are written next to the output and
 * referenced from the config file; URLs stay URLs.
 *
 * A decompiled archive is untrusted and the output directory is often the
 * user's workspace, so embedded sources are never written over an existing
 * path and never through a symlink. An extension that cannot be written is
 * still loaded from the archive in memory, so its blocks decompile normally,
 * and its own data URI is recorded in the config so later builds keep it.
 *
 * @param {object} project parsed project.json
 * @param {string|null} outDir directory that receives the config and extension files
 * @param {{fetchRemote?: boolean}} [options] `fetchRemote` loads plain URLs
 *   instead of skipping them, which costs a network request per extension.
 * @returns {{entries: string[], loadEntries: string[], files: string[], warnings: string[]}}
 */
function restoreExtensions(project, outDir, { fetchRemote = false } = {}) {
  const result = { entries: [], loadEntries: [], files: [], warnings: [] };
  const urls = project && project.extensionURLs;
  if (!urls || typeof urls !== "object") return result;

  // Resolve the directory that receives embedded sources once, refusing a
  // symlinked `extensions/` (which would redirect every write) and verifying
  // that it really is a plain child of the output directory.
  let extensionDir = null;
  let extensionDirProblem = null;
  const resolveExtensionDir = () => {
    if (extensionDir || extensionDirProblem) return;
    const dir = path.join(outDir, "extensions");
    const existing = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (existing && !existing.isDirectory()) {
      extensionDirProblem = existing.isSymbolicLink()
        ? `"${dir}" is a symlink, so the extension would land outside the output directory`
        : `"${dir}" is not a directory`;
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const expected = path.join(fs.realpathSync(outDir), "extensions");
    const actual = fs.realpathSync(dir);
    if (actual !== expected) {
      extensionDirProblem = `"${dir}" resolves to ${actual}, outside the output directory`;
      return;
    }
    extensionDir = dir;
  };

  const used = new Set();
  for (const [id, value] of Object.entries(urls)) {
    const uri = typeof value === "string" ? value.trim() : "";
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) {
      result.entries.push(uri);
      if (fetchRemote) result.loadEntries.push(uri);
      else
        result.warnings.push(
          `extension ${id} points at a remote URL (${truncate(uri, 48)}); ` +
            "not fetching it, so its blocks stay unsupported — pass " +
            "--fetch-extensions to load it",
        );
      continue;
    }
    if (!/^data:/i.test(uri)) {
      result.warnings.push(
        `extension ${id} uses an unsupported URL (${truncate(uri, 48)}); ` +
          `add it to ${configFilename(product)} by hand`,
      );
      continue;
    }
    const source = readExtensionDataUri(uri);
    if (source == null) {
      result.warnings.push(
        `extension ${id} has an unreadable data URI; ` +
          `add it to ${configFilename(product)} by hand`,
      );
      continue;
    }
    // When no file can be written, the archive's own copy is the only faithful
    // reference left, so the config keeps its data URI: a later build still has
    // the extension without overwriting, or depending on, a workspace file.
    const keepEmbedded = (warning) => {
      result.loadEntries.push(uri);
      if (outDir) result.entries.push(uri);
      result.warnings.push(warning);
    };
    if (!outDir) {
      keepEmbedded(
        `extension ${id} is embedded in the archive; pass -o to write it out ` +
          `and reference it from ${configFilename(product)}`,
      );
      continue;
    }
    resolveExtensionDir();
    if (extensionDirProblem) {
      keepEmbedded(
        `extension ${id} was not written: ${extensionDirProblem}; its blocks ` +
          "still decompile and the config keeps its source, but the extension " +
          "file is missing from the output",
      );
      continue;
    }
    const base = extensionFileStem(id);
    let stem = base;
    for (let suffix = 2; used.has(stem); suffix += 1)
      stem = `${base}-${suffix}`;
    used.add(stem);
    const file = path.join(extensionDir, `${stem}.js`);
    const relative = `extensions/${stem}.js`;
    const existing = fs.lstatSync(file, { throwIfNoEntry: false });
    if (existing) {
      // Never replace a workspace file. An identical regular file is already
      // the copy we would have written, so reference it and leave it alone.
      if (existing.isFile() && fs.readFileSync(file, "utf8") === source) {
        result.files.push(relative);
        result.entries.push(relative);
        result.loadEntries.push(file);
      } else {
        keepEmbedded(
          `extension ${id} not written to ${relative}: ` +
            (existing.isSymbolicLink()
              ? "the path is a symlink"
              : "a different file already exists") +
            "; the config keeps the archive's copy, so delete or rename it to " +
            "write the extension file",
        );
      }
      continue;
    }
    try {
      // `wx` fails instead of following a path that appeared in the meantime.
      fs.writeFileSync(file, source, { flag: "wx" });
    } catch (err) {
      keepEmbedded(
        `extension ${id} not written to ${relative}: ` +
          (err.code === "EEXIST"
            ? "the path appeared while decompiling"
            : `${err.code || err.message}`) +
          "; the config keeps the archive's copy, so delete or rename it to " +
          "write the extension file",
      );
      continue;
    }
    result.files.push(relative);
    result.entries.push(relative);
    result.loadEntries.push(file);
  }
  return result;
}

/**
 * Record restored extensions in `fx.yml`, creating one next to the decompiled
 * source when the directory has none yet.
 *
 * @param {string} outDir
 * @param {string[]} entries
 * @returns {{file: string, added: number}|null}
 */
function writeRestoredConfig(outDir, entries) {
  if (entries.length === 0) return null;
  const existing = configFilenames()
    .map((name) => path.join(outDir, name))
    .find((file) => fs.existsSync(file));
  if (existing) {
    let added = 0;
    for (const entry of entries)
      if (addProjectExtension(existing, entry).added) added += 1;
    return { file: existing, added };
  }
  const file = path.join(outDir, configFilenames()[0]);
  const lines = ["project:", "  extensions:"];
  for (const entry of entries) lines.push(`    - ${JSON.stringify(entry)}`);
  lines.push("");
  fs.writeFileSync(file, lines.join("\n"));
  return { file, added: entries.length };
}

async function cmdDecompile(args) {
  const input = args._[0];
  if (!input)
    fail(`decompile requires an input .pmp file\n\n${usage(process.stderr)}`);
  const data = fs.readFileSync(input);
  const files = unzipSync(data);
  const projectJson = files.get("project.json");
  if (!projectJson) fail("Not a Scratch project: missing project.json");
  const project = JSON.parse(projectJson.toString("utf8"));

  const output = args.flags.o || args.flags.output;
  const outDir = output ? path.dirname(path.resolve(output)) : null;
  const restored = restoreExtensions(project, outDir, {
    fetchRemote: Boolean(args.flags["fetch-extensions"]),
  });
  for (const warning of restored.warnings)
    process.stderr.write(`warning: ${warning}\n`);

  // Extension sources also feed the catalog, so extension blocks decompile as
  // real calls instead of "unsupported block".
  let catalog = {};
  if (restored.loadEntries.length > 0) {
    const loaded = await loadExtensions(restored.loadEntries, {
      baseDir: outDir || process.cwd(),
    });
    catalog = loaded.catalog;
    for (const warning of loaded.warnings)
      process.stderr.write(`warning: ${warning}\n`);
  }

  const assetDir = args.flags.assets;
  let assetPrefix = "";
  if (assetDir) {
    fs.mkdirSync(assetDir, { recursive: true });
    const resolvedAssetDir = fs.realpathSync(assetDir);
    for (const [name, buffer] of files) {
      if (!/^[0-9a-f]{32}\.[a-z0-9]+(?![\s\S])/i.test(name)) continue;
      const destination = path.resolve(resolvedAssetDir, name);
      if (path.dirname(destination) !== resolvedAssetDir) continue;
      // Existing symlinks could redirect an otherwise safe name outside the directory.
      if (
        fs.lstatSync(destination, { throwIfNoEntry: false })?.isSymbolicLink()
      )
        continue;
      fs.writeFileSync(destination, buffer);
    }
    // Reference assets relative to the directory the source file will live in.
    const rel = path
      .relative(outDir || process.cwd(), path.resolve(assetDir))
      .replace(/\\/g, "/");
    assetPrefix = rel ? `${rel}/` : "";
  }

  const source = decompileProject(project, { assetPrefix, catalog });
  if (output) {
    fs.writeFileSync(output, source);
    const config = writeRestoredConfig(outDir, restored.entries);
    log.success(`Decompiled ${input} -> ${output}`);
    if (config)
      log.success(
        `Restored ${config.added} extension(s) -> ${
          path.relative(process.cwd(), config.file) || config.file
        }`,
      );
  } else {
    process.stdout.write(source);
  }
}

function initFiles() {
  return {
    [configFilename(product)]: `project:
  name: "My ${product.name} Project"
  fps: 60
  width: 480
  height: 360
  turbo: false
  interpolation: true
fx:
  partialSprites: false
package:
  target: html
`,
    [`${sourceDirectory(product)}/main${EXTENSION}`]: `sprite "Cat" {
    costumes: {
        cat: "../assets/cat.svg"
    };

    let score = 0;

    when greenFlag {
        motion.goToXY(0, 0);
        control.forever {
            motion.turnRight(1);
        }
    }

    when keyPressed("space") {
        score += 1;
        looks.sayForSecs(operators.join("Score: ", score), 1);
    }
}
`,
    "assets/cat.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="95" height="101" viewBox="0 0 95 101">
  <ellipse cx="47" cy="60" rx="35" ry="35" fill="#ffab19" stroke="#cf8b17" stroke-width="4"/>
  <circle cx="35" cy="50" r="6" fill="#000"/>
  <circle cx="60" cy="50" r="6" fill="#000"/>
</svg>
`,
  };
}

function cmdInit(args) {
  const dir = args._[0] || ".";
  for (const [rel, content] of Object.entries(initFiles())) {
    const dest = path.join(dir, rel);
    if (fs.existsSync(dest)) {
      log.warn(`skip ${dest} (exists)`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    log.bullet(dest);
  }
}

function requireConfigPath() {
  const found = findConfigPath(process.cwd());
  if (!found)
    fail(
      `No ${configFilename(product)} found. Run "${product.command} init" first.`,
    );
  return found;
}

async function readInputBytes(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Could not download ${source}: ${response.status} ${response.statusText}`,
      );
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.readFileSync(source);
}

/** Every sprite declaration under `dir`, in source order. */
function spriteNames(dir) {
  const sprites = [];
  for (const file of discoverSources(dir)) {
    const ast = parse(fs.readFileSync(file, "utf8"), file);
    for (const sprite of ast.sprites) {
      sprites.push({ name: sprite.name, file, partial: sprite.partial });
    }
  }
  return sprites;
}

/** Group sprite declarations by name, tracking the base declaration. */
function spriteGroups(dir) {
  const groups = new Map();
  for (const entry of spriteNames(dir)) {
    let group = groups.get(entry.name);
    if (!group) {
      group = {
        name: entry.name,
        file: entry.file,
        files: [],
        partial: true,
      };
      groups.set(entry.name, group);
    }
    group.files.push(entry.file);
    if (!entry.partial) {
      group.file = entry.file;
      group.partial = false;
    }
  }
  for (const group of groups.values()) {
    // Show the base file first, then fragments in discovery order.
    group.files = [...new Set([group.file, ...group.files])];
  }
  return [...groups.values()];
}

function cmdExtensionAdd(args) {
  const source = args._[1];
  if (!source) fail("extension add requires a path or URL");
  const configPath = requireConfigPath();
  let unsandboxed = null;
  if (args.flags.unsandboxed !== undefined) {
    if (typeof args.flags.unsandboxed !== "string")
      fail("--unsandboxed needs an extension id");
    unsandboxed = args.flags.unsandboxed;
  }

  const { added, unsandboxedAdded } = addProjectExtension(configPath, source, {
    unsandboxed,
  });
  if (added) log.success(`Added ${source} to ${path.basename(configPath)}`);
  else log.info(`${source} is already listed in ${path.basename(configPath)}`);
  if (unsandboxed && unsandboxedAdded)
    log.success(`Allowed ${unsandboxed} to run unsandboxed`);
}

function cmdExtensionRemove(args) {
  const target = args._[1];
  if (!target) fail("extension remove requires a path, URL or extension id");
  const configPath = requireConfigPath();
  const result = removeProjectExtension(configPath, target);
  if (result.extensions.length > 0)
    log.success(
      `Removed ${result.extensions.join(", ")} from ${path.basename(configPath)}`,
    );
  if (result.unsandboxedRemoved)
    log.success(`Removed ${target} from the unsandboxed list`);
}

function cmdExtensionList(args) {
  const configPath = requireConfigPath();
  const { extensions, unsandboxed } = readProjectExtensions(configPath);
  if (args.flags.json) {
    process.stdout.write(
      `${JSON.stringify({ extensions, unsandboxed }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(
    `${path.basename(configPath)}: ${extensions.length} extension(s)\n`,
  );
  for (const entry of extensions) process.stdout.write(`  ${entry}\n`);
  process.stdout.write(`unsandboxed: ${unsandboxed.join(", ") || "(none)"}\n`);
}

function cmdExtension(args) {
  switch (args._[0]) {
    case "add":
      return cmdExtensionAdd(args);
    case "remove":
      return cmdExtensionRemove(args);
    case "list":
      return cmdExtensionList(args);
    default:
      fail(`extension expects add, remove or list\n\n${usage(process.stderr)}`);
  }
}

/** Turn a command-line local path into a path relative to fx.yml. */
function vendorConfigSource(source, configDir) {
  if (/^https?:\/\//i.test(source) || /^data:/i.test(source)) return source;
  const absolute = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
  const relative = path.relative(configDir, absolute).split(path.sep).join("/");
  if (!relative) return ".";
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Join configured vendor entries with their lock metadata for listing. */
function vendorEntriesWithLock(loaded, lock, configDir) {
  const dirName = loaded.vendorDir || "extensions";
  const dir = path.resolve(configDir, dirName);
  const files = resolveVendorFiles(configDir, dir, loaded.vendor || [], lock);
  return (loaded.vendor || []).map((entry) => {
    const { file } = files.get(entry.name);
    return {
      name: entry.name,
      source: entry.source,
      file,
      remote: entry.remote,
      local: entry.local,
      volatile: entry.volatile,
      unsandboxed: entry.unsandboxed,
      sha256: lock.extensions[entry.name]?.sha256 ?? null,
      fetched: lock.extensions[entry.name]?.fetched ?? null,
    };
  });
}

/** Install one extension, or restore every configured vendor entry. */
async function cmdVendorInstall(args) {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  const source = args._[1];

  if (!source) {
    if (loaded.vendor.length === 0)
      fail(
        `No vendor entries in ${path.basename(configPath)}. ` +
          `Add one with "${product.command} vendor install <url|path>".`,
      );
    const result = await installVendor({
      configPath,
      configDir,
      config: loaded,
    });
    for (const warning of result.warnings)
      process.stderr.write(`warning: ${warning}\n`);
    for (const entry of result.entries)
      log.success(`${entry.name}: ${entry.status} (${entry.file})`);
    log.success(
      `Installed ${result.entries.length} extension(s) from ${LOCK_FILENAME}`,
    );
    return;
  }

  if (args.flags.as === true) fail("--as needs a name");
  const name =
    typeof args.flags.as === "string"
      ? args.flags.as
      : defaultVendorName(source);
  const configSource = vendorConfigSource(source, configDir);
  const existing = loaded.vendor.find((entry) => entry.name === name);
  if (existing && existing.source !== configSource && !args.flags.force)
    fail(
      `A vendored extension named ${JSON.stringify(name)} already exists. ` +
        `Use "${product.command} vendor update ${name}" or pass --force to replace it.`,
    );

  const rawEntry = loaded.raw?.vendor?.[name];
  const existingVolatile =
    rawEntry &&
    typeof rawEntry === "object" &&
    Object.hasOwn(rawEntry, "volatile") &&
    rawEntry.volatile != null
      ? Boolean(rawEntry.volatile)
      : undefined;
  const result = await installVendorEntry({
    configPath,
    configDir,
    name,
    source: configSource,
    vendorDir: path.resolve(configDir, loaded.vendorDir || "extensions"),
    unsandboxed:
      Boolean(args.flags.unsandboxed) || Boolean(existing?.unsandboxed),
    volatile: existingVolatile,
  });
  log.success(
    `Vendored ${name} -> ${result.file} (${result.lockEntry.sha256.slice(0, 12)}…)`,
  );
  if (existing) log.info(`Updated ${name} in ${path.basename(configPath)}`);
  else log.success(`Added ${name} to ${path.basename(configPath)}`);
}

/** Re-fetch vendor sources and optionally preview the diff. */
async function cmdVendorUpdate(args) {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  if (loaded.vendor.length === 0)
    fail(`No vendor entries in ${path.basename(configPath)}`);

  const name = args._[1];
  const dryRun = Boolean(args.flags["dry-run"]);
  const result = await updateVendor({
    configPath,
    configDir,
    config: loaded,
    name,
    write: !dryRun,
  });
  for (const entry of result.entries) {
    if (!entry.changed) {
      log.info(`${entry.name} is up to date`);
      continue;
    }
    process.stdout.write(entry.diff);
  }
  if (dryRun && result.changed > 0)
    log.info(`Dry run: ${result.changed} extension(s) would change`);
  else if (result.changed > 0)
    log.success(`Updated ${result.changed} extension(s)`);
  else log.success("Everything is up to date");
}

/** Report vendor entries whose upstream source changed. */
async function cmdVendorOutdated() {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  if (loaded.vendor.length === 0)
    fail(`No vendor entries in ${path.basename(configPath)}`);

  const results = await outdatedVendor({ configDir, config: loaded });
  let outdated = 0;
  let errors = 0;
  for (const result of results) {
    if (result.status === "outdated") outdated += 1;
    if (result.status === "error") errors += 1;
    const label =
      result.status === "outdated"
        ? "outdated"
        : result.status === "error"
          ? "error"
          : "up to date";
    process.stdout.write(`  ${result.name.padEnd(24)} ${label}\n`);
    if (result.error) process.stderr.write(`warning: ${result.error}\n`);
  }
  if (outdated > 0)
    log.warn(
      `${outdated} extension(s) changed upstream; run "${product.command} vendor update"`,
    );
  else if (errors === 0) log.success("Everything is up to date");
  if (errors > 0) process.exitCode = 1;
}

/** Verify vendored files offline against fx.lock. */
function cmdVendorVerify() {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  if (loaded.vendor.length === 0)
    fail(`No vendor entries in ${path.basename(configPath)}`);

  const result = verifyVendor({ configDir, config: loaded });
  for (const warning of result.warnings) log.warn(warning);
  for (const entry of result.entries)
    if (entry.status === "ok")
      process.stdout.write(`  ${entry.name.padEnd(24)} ${entry.file}\n`);
  if (!result.ok) {
    for (const problem of result.problems) log.error(problem);
    process.exitCode = 1;
    return;
  }
  log.success(
    `Verified ${result.entries.length} extension(s) against ${LOCK_FILENAME}`,
  );
}

/** Remove a vendored entry from fx.yml, fx.lock and disk. */
function cmdVendorRemove(args) {
  const name = args._[1];
  if (!name) fail("vendor remove requires an extension name");
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);

  const result = removeVendoredExtension({
    configPath,
    configDir,
    config: loaded,
    name,
  });
  log.success(
    `Removed ${name} from ${path.basename(configPath)}, ${LOCK_FILENAME} and ${result.file}`,
  );
}

/** List configured vendor entries and their flags. */
function cmdVendorList(args) {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  const lock = readLock(configDir);
  const entries = vendorEntriesWithLock(loaded, lock, configDir);

  if (args.flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          vendorDir: loaded.vendorDir || "extensions",
          extensions: entries,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(
    `${path.basename(configPath)}: ${entries.length} vendored extension(s) in ${
      loaded.vendorDir || "extensions"
    }/\n`,
  );
  for (const entry of entries) {
    const flags = [
      entry.remote ? "remote" : entry.local ? "local" : "embedded",
      entry.volatile ? "volatile" : null,
      entry.unsandboxed ? "unsandboxed" : null,
    ]
      .filter(Boolean)
      .join(", ");
    process.stdout.write(
      `  ${entry.name.padEnd(24)} ${entry.file}${flags ? ` [${flags}]` : ""}\n`,
    );
  }
}

/** Move legacy project.extensions entries into the vendor system. */
async function cmdVendorMigrate(args) {
  const configPath = requireConfigPath();
  const configDir = path.dirname(configPath);
  const loaded = loadConfigFrom(configDir);
  if (loaded.project.extensions.length === 0)
    fail(`No project.extensions to migrate in ${path.basename(configPath)}`);

  const interactive = canPrompt(args.flags) && !args.flags.yes;
  const result = await migrateProjectExtensions({
    configPath,
    configDir,
    config: loaded,
    nameFor: interactive
      ? (name, source) => askName(`Name for ${source}`, name)
      : undefined,
  });
  for (const warning of result.warnings)
    process.stderr.write(`warning: ${warning}\n`);
  if (result.diff) process.stdout.write(result.diff);
  log.success(`Backed up ${path.basename(configPath)} -> ${result.backup}`);
  log.success(`Migrated ${result.migrated.length} extension(s) to vendor:`);
  for (const entry of result.migrated)
    process.stdout.write(`  ${entry.name.padEnd(24)} ${entry.file}\n`);
}

/** Dispatch the vendor subcommands. */
async function cmdVendor(args) {
  switch (args._[0]) {
    case "install":
      return cmdVendorInstall(args);
    case "update":
      return cmdVendorUpdate(args);
    case "outdated":
      return cmdVendorOutdated();
    case "verify":
      return cmdVendorVerify();
    case "remove":
      return cmdVendorRemove(args);
    case "list":
      return cmdVendorList(args);
    case "migrate":
      return cmdVendorMigrate(args);
    default:
      fail(
        `vendor expects install, update, outdated, verify, remove, list or migrate\n\n${usage(
          process.stderr,
        )}`,
      );
  }
}

async function cmdSpriteAdd(args) {
  const source = args._[1];
  if (!source) fail("sprite add requires a .sprite3/.pms file or URL");
  const configPath = findConfigPath(process.cwd());
  const rootDir = configPath ? path.dirname(configPath) : process.cwd();

  const { sprite, assets } = readSprite(await readInputBytes(source));
  const name =
    typeof args.flags.name === "string" ? args.flags.name : sprite.name;
  if (!name) fail("sprite add could not read a sprite name; pass --name");
  sprite.name = name;

  const existing = spriteNames(rootDir).find((entry) => entry.name === name);
  if (existing)
    fail(
      `A sprite named ${JSON.stringify(name)} already exists in ${existing.file}`,
    );

  const sourceDir = path.join(rootDir, sourceDirectory(product));
  const file = path.join(sourceDir, `${slugify(name)}${EXTENSION}`);
  if (fs.existsSync(file) && !args.flags.force)
    fail(`${file} already exists; pass --force to overwrite`);

  const assetsDir = path.join(rootDir, "assets");
  const relative = path.relative(sourceDir, assetsDir).replace(/\\/g, "/");
  const text = spriteSource(sprite, {
    assetPrefix: relative ? `${relative}/` : "",
  });
  parse(text, file);

  fs.mkdirSync(assetsDir, { recursive: true });
  for (const [assetName, data] of assets)
    fs.writeFileSync(path.join(assetsDir, assetName), data);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(file, text);
  log.success(`Added sprite ${name} -> ${path.relative(rootDir, file)}`);
}

async function cmdSpriteBuild(args) {
  const name = args._[1];
  if (!name) fail("sprite build requires a sprite name");
  const dir = process.cwd();
  const loaded = await loadProjectConfiguration(dir, args.flags);
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : dir;
  const { catalog, extensionUrls } = await loadProjectExtensions(
    extBase,
    loaded,
  );
  const result = build({
    dir,
    projectConfig: config,
    fxConfig: loaded.fx,
    catalog,
    extensionUrls,
    useConfigFile: !args.flags["no-config"],
  });

  const sprite = result.project.targets.find(
    (target) => !target.isStage && target.name === name,
  );
  if (!sprite) {
    const available = result.project.targets
      .filter((target) => !target.isStage)
      .map((target) => target.name);
    fail(
      `No sprite named ${JSON.stringify(name)}. ` +
        (available.length
          ? `Available: ${available.join(", ")}`
          : "The project has no sprites."),
    );
  }

  const explicit = args.flags.o || args.flags.output;
  const output =
    explicit ||
    path.join(dir, outputDirectory(product), `${slugify(name)}.pms`);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, spriteArchive(sprite, result.assets));
  log.success(`Built sprite ${name} -> ${output}`);
}

function cmdSpriteRemove(args) {
  const name = args._[1];
  if (!name) fail("sprite remove requires a sprite name");
  const dir = process.cwd();
  const matches = spriteNames(dir).filter((entry) => entry.name === name);
  if (matches.length === 0)
    fail(`No sprite named ${JSON.stringify(name)} under ${dir}`);

  const files = [...new Set(matches.map((entry) => entry.file))];
  for (const file of files) {
    const ast = parse(fs.readFileSync(file, "utf8"), file);
    const onlyThisSprite =
      ast.sprites.length > 0 &&
      ast.sprites.every((sprite) => sprite.name === name) &&
      ast.topItems.length === 0 &&
      !ast.stage;
    if (!onlyThisSprite)
      fail(`${file} also declares other code; remove the sprite block by hand`);
  }

  for (const file of files) fs.rmSync(file);
  log.success(
    `Removed sprite ${name} (${files
      .map((file) => path.relative(dir, file) || file)
      .join(", ")})`,
  );
}

function cmdSpriteList(args) {
  const dir = path.resolve(args._[1] || process.cwd());
  const sprites = spriteGroups(dir);
  if (args.flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        sprites.map(({ name, file, files, partial }) => ({
          name,
          file: path.relative(dir, file),
          files: files.map((entry) => path.relative(dir, entry)),
          partial,
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (sprites.length === 0) {
    log.info(`No sprites under ${dir}`);
    return;
  }
  for (const { name, files } of sprites)
    process.stdout.write(
      `  ${name.padEnd(24)} ${files
        .map((file) => path.relative(dir, file) || file)
        .join(", ")}\n`,
    );
}

async function cmdSprite(args) {
  switch (args._[0]) {
    case "add":
      return cmdSpriteAdd(args);
    case "build":
      return cmdSpriteBuild(args);
    case "remove":
      return cmdSpriteRemove(args);
    case "list":
      return cmdSpriteList(args);
    default:
      fail(
        `sprite expects add, build, remove or list\n\n${usage(process.stderr)}`,
      );
  }
}

function printVersion() {
  process.stdout.write(`${brandText(product.name)} ${product.version}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const rawCommand = argv.shift();
  const command = COMMAND_ALIASES[rawCommand] || rawCommand;
  const args = parseArgs(argv, command);

  if (args.flags.version || args.flags.v) {
    printVersion();
    return;
  }

  switch (command) {
    case "build":
      return cmdBuild(args);
    case "package":
      return cmdPackage(args);
    case "dev":
      return cmdDev(args);
    case "decompile":
      return cmdDecompile(args);
    case "check":
      return cmdCheck(args);
    case "catalog":
      return cmdCatalog(args);
    case "init":
      return cmdInit(args);
    case "extension":
      return cmdExtension(args);
    case "vendor":
      return cmdVendor(args);
    case "sprite":
      return cmdSprite(args);
    case "--version":
    case "-v":
      printVersion();
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage());
      return;
    default:
      log.error(
        `We don't recognize that command: ${JSON.stringify(command)}. ` +
          `Try '${product.command} help'.`,
      );
      process.stdout.write(usage());
      process.exitCode = 1;
      return;
  }
}

main().catch((err) => {
  if (err && err.name === "VendorError")
    process.stderr.write(`error: ${err.message}\n`);
  else if (err && typeof err.format === "function")
    process.stderr.write(`${err.format()}\n`);
  else process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
