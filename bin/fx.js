#!/usr/bin/env node
/**
 * Triflare Fx command line interface.
 *
 *   fx build [input.tfx | dir] [-o out.pmp] [--no-config]   (alias: b)
 *   fx decompile <input.pmp> [-o out.tfx] [--assets <dir>]  (alias: d)
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

function parseArgs(argv) {
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
  ]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      if (inline !== undefined) args.flags[key] = inline;
      else if (booleanFlags.has(key)) args.flags[key] = true;
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
  ${command} decompile <input.pmp> [-o <output${EXTENSION}>] [--assets <dir>]
  ${command} check [<input${EXTENSION}>|<dir>]
  ${command} catalog [<dir>] [--json]
  ${command} init [dir]

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

Command groups:
  extension add <source> [--unsandboxed <id>]
                 Add an extension (path or URL) to ${configFilename(product)}.
  extension remove <source|id>
                 Remove an extension from ${configFilename(product)}.
  extension list [--json]
                 List configured extensions.
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
  --target <t>    Packaging target (html, zip, windows, macos, linux, …)
  --extract       Unzip a packaged desktop/zip archive
  --host [host]   Dev server host; with no value listen on all interfaces
  --lan           Alias for listening on all interfaces
  --port <port>   Dev server port (default 3000)
  --strict-port   Fail instead of picking the next free dev port
  --json          Machine readable output (catalog)
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

async function loadProjectExtensions(dir, config) {
  const catalog = {};
  const extensionUrls = {};
  const unsandboxed = [];
  if (!config.extensions || config.extensions.length === 0)
    return { catalog, extensionUrls, unsandboxed };
  const loaded = await loadExtensions(config.extensions, {
    baseDir: dir,
    expectUnsandboxed: config.unsandboxed,
  });
  Object.assign(catalog, loaded.catalog);
  Object.assign(extensionUrls, loaded.extensionUrls);
  unsandboxed.push(...loaded.unsandboxed);
  for (const warning of loaded.warnings)
    process.stderr.write(`warning: ${warning}\n`);
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

async function cmdBuild(args) {
  const target = resolveInput(args._[0]);
  const searchDir = target.file ? path.dirname(target.file) : target.dir;

  const loaded = args.flags["no-config"]
    ? { project: null, fx: null, path: null }
    : loadConfigFrom(searchDir);
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : searchDir;
  const { catalog, extensionUrls, unsandboxed } = await loadProjectExtensions(
    extBase,
    config || {},
  );

  const result = build({
    ...target,
    projectConfig: config,
    fxConfig: loaded.fx,
    catalog,
    extensionUrls,
    useConfigFile: !args.flags["no-config"],
  });

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
    loaded.project || {},
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

async function cmdPackage(args) {
  const target = resolveInput(args._[0]);
  const loaded = args.flags["no-config"]
    ? { project: null, fx: null, package: null, path: null }
    : loadConfigFrom(target.file ? path.dirname(target.file) : target.dir);
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
      ? loadConfigFrom(searchDir)
      : { project: null, fx: null, package: null, path: null };
    const configBase = loaded.path ? path.dirname(loaded.path) : searchDir;
    const { catalog, extensionUrls } = await loadProjectExtensions(
      configBase,
      loaded.project || {},
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

async function cmdCatalog(args) {
  // Merge the built-in catalog with any extensions declared in fx.yml, so
  // blocks from path- or URL-loaded extensions show up here too.
  const loaded = args.flags["no-config"]
    ? { project: null, path: null }
    : loadConfigFrom(args._[0] || process.cwd());
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : process.cwd();
  const { catalog } = await loadProjectExtensions(extBase, config || {});

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
 * @param {object} project parsed project.json
 * @param {string|null} outDir directory that receives the config and extension files
 * @returns {{entries: string[], loadEntries: string[], files: string[], warnings: string[]}}
 */
function restoreExtensions(project, outDir) {
  const result = { entries: [], loadEntries: [], files: [], warnings: [] };
  const urls = project && project.extensionURLs;
  if (!urls || typeof urls !== "object") return result;

  const used = new Set();
  for (const [id, value] of Object.entries(urls)) {
    const uri = typeof value === "string" ? value.trim() : "";
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) {
      result.entries.push(uri);
      result.loadEntries.push(uri);
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
    if (!outDir) {
      result.loadEntries.push(uri);
      result.warnings.push(
        `extension ${id} is embedded in the archive; pass -o to write it out ` +
          `and reference it from ${configFilename(product)}`,
      );
      continue;
    }
    const base = extensionFileStem(id);
    let stem = base;
    for (let suffix = 2; used.has(stem); suffix += 1)
      stem = `${base}-${suffix}`;
    used.add(stem);
    const file = path.join(outDir, "extensions", `${stem}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    const relative = path.relative(outDir, file).split(path.sep).join("/");
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
  const restored = restoreExtensions(project, outDir);
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
  const loaded = args.flags["no-config"]
    ? { project: null, fx: null, path: null }
    : loadConfigFrom(dir);
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : dir;
  const { catalog, extensionUrls } = await loadProjectExtensions(
    extBase,
    config || {},
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
  const args = parseArgs(argv);

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
  if (err && typeof err.format === "function")
    process.stderr.write(`${err.format()}\n`);
  else process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
