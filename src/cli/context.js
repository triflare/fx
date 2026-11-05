/**
 * Shared project discovery for every command.
 *
 * Resolves the input path, the nearest (or explicitly selected) `fx.yml`, and
 * the extension catalog once, so commands do not repeat subtly different
 * versions of the same logic.
 */

import fs from "node:fs";
import path from "node:path";
import { configFilename, outputDirectory, sourceExtension } from "../brand.js";
import { loadConfigFrom, parseConfig } from "../config.js";
import { loadExtensions } from "../extensions.js";
import { loadVendorExtensions, migrateProjectExtensions } from "../vendor.js";
import { UsageError } from "./errors.js";

const warnedLegacy = new Set();
const migrationDeclined = new Set();

/** Split a positional input into a file or directory target. */
export function resolveInput(input, cwd = process.cwd()) {
  if (!input) return { dir: path.resolve(cwd) };
  const resolved = path.resolve(cwd, input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new UsageError(`input not found: ${input}`, {
      hint: `check the path, or run from the project directory`,
    });
  }
  return stat.isDirectory() ? { dir: resolved } : { file: resolved };
}

export function inputSearchDir(target) {
  return target.file ? path.dirname(target.file) : target.dir;
}

/** Whether `--no-config` disables configuration loading. */
export function configDisabled(options = {}) {
  return options.config === false || options.noConfig === true;
}

/** Load configuration from an explicit path or by searching upward. */
export function loadProjectConfig({ cwd = process.cwd(), searchDir, options }) {
  if (configDisabled(options)) {
    return {
      project: null,
      fx: null,
      package: null,
      vendor: [],
      vendorDir: "extensions",
      path: null,
    };
  }

  const explicit = typeof options.config === "string" ? options.config : null;
  if (!explicit) return loadConfigFrom(searchDir);
  const explicitPath = path.resolve(cwd, explicit);
  if (!fs.existsSync(explicitPath))
    throw new UsageError(`config file not found: ${explicitPath}`);
  if (!fs.statSync(explicitPath).isFile())
    throw new UsageError(`config path is not a file: ${explicitPath}`);

  try {
    const parsed = parseConfig(fs.readFileSync(explicitPath, "utf8"));
    return { ...parsed, path: explicitPath };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error.message, { cause: error });
  }
}

function warnLegacyExtensions(loaded, reporter) {
  if (!loaded?.project?.extensions?.length) return;
  const key = loaded.path ?? "<default>";
  if (warnedLegacy.has(key)) return;
  warnedLegacy.add(key);
  reporter.warn(
    `project.extensions is deprecated and will be removed in a future major version; ` +
      `run "${configFilename()} vendor migrate" to move extensions into vendor:`,
  );
}

/**
 * Offer to migrate legacy project.extensions before extensions are loaded.
 * `--yes` accepts without a terminal; otherwise the prompt only runs on one.
 */
async function upgradeLegacyExtensions({
  loaded,
  cwd,
  searchDir,
  options = {},
  reporter,
  prompts,
}) {
  if (!loaded?.path || !loaded.project?.extensions?.length) return loaded;
  warnLegacyExtensions(loaded, reporter);
  if (migrationDeclined.has(loaded.path)) return loaded;
  if (options.upgradePrompt === false || process.env.FX_NO_PROMPT === "1")
    return loaded;

  const auto = Boolean(options.yes);
  const interactive = !auto && Boolean(prompts?.enabled);
  if (!auto && !interactive) return loaded;
  if (!auto) {
    const upgrade = await prompts.confirm({
      message: "Upgrade project.extensions to the vendor system?",
      initialValue: true,
    });
    if (!upgrade) {
      migrationDeclined.add(loaded.path);
      return loaded;
    }
  }

  try {
    const result = await migrateProjectExtensions({
      configPath: loaded.path,
      configDir: path.dirname(loaded.path),
      config: loaded,
      nameFor: interactive
        ? (name, source) =>
            prompts.text({
              message: `Name for ${source}`,
              defaultValue: name,
            })
        : undefined,
    });
    for (const warning of result.warnings) reporter.warn(warning);
    if (result.diff) reporter.text(result.diff);
    if (result.migrated.length > 0)
      reporter.success(
        `Vendored ${result.migrated.length} extension(s); backup: ${path.relative(
          cwd,
          result.backup,
        )}`,
      );
    return loadProjectConfig({ cwd, searchDir, options, reporter });
  } catch (error) {
    reporter.warn(`Could not migrate project.extensions: ${error.message}`);
    return loaded;
  }
}

/** Load vendored and legacy extensions into one catalog. */
export async function loadProjectExtensions({ configDir, loaded, reporter }) {
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
    for (const warning of vendored.warnings) reporter.warn(warning);
  }

  if (config.extensions && config.extensions.length > 0) {
    warnLegacyExtensions(loaded, reporter);
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
    for (const warning of legacy.warnings) reporter.warn(warning);
  }

  for (const name of new Set(config.unsandboxed || [])) {
    if (unnecessaryUnsandboxed.has(name)) {
      reporter.warn(
        `project.unsandboxed entry "${name}" loads in the sandbox; remove it from fx.yml`,
      );
    } else if (!matchedUnsandboxed.has(name)) {
      reporter.warn(
        `project.unsandboxed entry "${name}" does not match any loaded extension`,
      );
    }
  }

  return { catalog, extensionUrls, unsandboxed };
}

/**
 * Resolve everything a build-like command needs.
 *
 * @param {{
 *   input?: string,
 *   cwd: string,
 *   options: object,
 *   reporter: object,
 *   prompts?: object,
 *   includeExtensions?: boolean,
 *   migrateLegacy?: boolean,
 * }} options
 */
export async function loadProjectState({
  input,
  cwd,
  options,
  reporter,
  prompts = null,
  includeExtensions = true,
  migrateLegacy = true,
}) {
  const target = resolveInput(input, cwd);
  const searchDir = inputSearchDir(target);
  let loaded = loadProjectConfig({ cwd, searchDir, options, reporter });
  if (migrateLegacy)
    loaded = await upgradeLegacyExtensions({
      loaded,
      cwd,
      searchDir,
      options,
      reporter,
      prompts,
    });
  const configDir = loaded.path ? path.dirname(loaded.path) : searchDir;
  const extensions = includeExtensions
    ? await loadProjectExtensions({ configDir, loaded, reporter })
    : { catalog: {}, extensionUrls: {}, unsandboxed: [] };

  return {
    target,
    searchDir,
    loaded,
    configDir,
    ...extensions,
  };
}

/** Default output directory for a directory build. */
export function defaultOutputDirectory(cwd) {
  return path.join(cwd, outputDirectory());
}

/** Source extension used in user-facing messages. */
export function sourceSuffix() {
  return sourceExtension();
}
