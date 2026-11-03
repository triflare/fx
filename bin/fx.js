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
import process from "node:process";
import { build } from "../src/build.js";
import { parse } from "../src/parser.js";
import { discoverSources } from "../src/project.js";
import { decompile } from "../src/decompiler.js";
import { unzipSync } from "../src/sb3.js";
import { CATALOG, blockNames } from "../src/catalog.js";
import {
  addProjectExtension,
  findConfigPath,
  loadConfigFrom,
  readProjectExtensions,
  removeProjectExtension,
} from "../src/config.js";
import { loadExtensions } from "../src/extensions.js";
import { readSprite, spriteArchive, spriteSource } from "../src/sprite.js";
import {
  brandText,
  configFilename,
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
  ${command} decompile <input.pmp> [-o <output${EXTENSION}>] [--assets <dir>]
  ${command} check [<input${EXTENSION}>|<dir>]
  ${command} catalog [<dir>] [--json]
  ${command} init [dir]

Commands:
  build     (b)  Compile a source file, or every ${EXTENSION} file in a directory
                 (defaults to the working directory) into one .pmp.
  decompile (d)  Convert a .pmp back into ${product.name} source.
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
  --json          Machine readable output (catalog)
  -v, --version   Print the version
`;
}

/** Long command name -> one-letter alias. */
const COMMAND_ALIASES = {
  b: "build",
  d: "decompile",
  c: "check",
  l: "catalog",
  i: "init",
};

function fail(message) {
  log.error(message);
  process.exit(1);
}

async function loadProjectExtensions(dir, config, { localFileWarning } = {}) {
  const catalog = {};
  const extensionUrls = {};
  const unsandboxed = [];
  if (!config.extensions || config.extensions.length === 0)
    return { catalog, extensionUrls, unsandboxed };
  const loaded = await loadExtensions(config.extensions, {
    baseDir: dir,
    expectUnsandboxed: config.unsandboxed,
    localFileWarning,
  });
  Object.assign(catalog, loaded.catalog);
  Object.assign(extensionUrls, loaded.extensionUrls);
  unsandboxed.push(...loaded.unsandboxed);
  for (const warning of loaded.warnings)
    process.stderr.write(`warning: ${warning}\n`);
  return { catalog, extensionUrls, unsandboxed };
}

/** Turn a project name into a filesystem-friendly slug. */
function slugify(name) {
  return (
    String(name || "project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
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
    ? { project: null, path: null }
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

function cmdCheck(args) {
  const target = resolveInput(args._[0]);
  const files = target.file ? [target.file] : discoverSources(target.dir);
  if (files.length === 0)
    fail(`No ${EXTENSION} files found under ${target.dir}`);

  for (const file of files) {
    parse(fs.readFileSync(file, "utf8"), file);
  }
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
  const { catalog } = await loadProjectExtensions(extBase, config || {}, {
    localFileWarning: false,
  });

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

function cmdDecompile(args) {
  const input = args._[0];
  if (!input)
    fail(`decompile requires an input .pmp file\n\n${usage(process.stderr)}`);
  const data = fs.readFileSync(input);
  const files = unzipSync(data);

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
    const outDir = path.dirname(
      path.resolve(
        args.flags.o ||
          args.flags.output ||
          path.join(process.cwd(), `out${EXTENSION}`),
      ),
    );
    const rel = path
      .relative(outDir, path.resolve(assetDir))
      .replace(/\\/g, "/");
    assetPrefix = rel ? `${rel}/` : "";
  }

  const source = decompile(data, { assetPrefix });
  const output = args.flags.o || args.flags.output;
  if (output) {
    fs.writeFileSync(output, source);
    log.success(`Decompiled ${input} -> ${output}`);
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

/** Every sprite declared under `dir`, in source order. */
function spriteNames(dir) {
  const sprites = [];
  for (const file of discoverSources(dir)) {
    const ast = parse(fs.readFileSync(file, "utf8"), file);
    for (const sprite of ast.sprites) sprites.push({ name: sprite.name, file });
  }
  return sprites;
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
    ? { project: null, path: null }
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
  if (matches.length > 1)
    fail(
      `${matches.length} files declare ${JSON.stringify(name)}; fix the duplicate first`,
    );

  const [{ file }] = matches;
  const ast = parse(fs.readFileSync(file, "utf8"), file);
  if (ast.sprites.length !== 1 || ast.topItems.length > 0 || ast.stage)
    fail(`${file} also declares other code; remove the sprite block by hand`);

  fs.rmSync(file);
  log.success(`Removed sprite ${name} (${path.relative(dir, file)})`);
}

function cmdSpriteList(args) {
  const dir = path.resolve(args._[1] || process.cwd());
  const sprites = spriteNames(dir);
  if (args.flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        sprites.map(({ name, file }) => ({
          name,
          file: path.relative(dir, file),
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
  for (const { name, file } of sprites)
    process.stdout.write(
      `  ${name.padEnd(24)} ${path.relative(dir, file) || file}\n`,
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
