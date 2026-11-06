/**
 * Built-in, project-local features.
 *
 * `fx feature <name> enable` copies a feature's extension source into the
 * project and records that file under `features:` in `fx.yml`. Builds load the
 * committed file, so an Fx upgrade never changes a project's feature code, and
 * the project keeps working offline (and in Fx versions that predate the
 * feature system) because the extension is an ordinary JavaScript file.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "./config.js";
import { addFeatureEntry, removeFeatureEntry } from "./config-edit.js";
import { loadExtensions } from "./extensions.js";
import { formatDiff } from "./vendor.js";

export class FeatureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FeatureError";
  }
}

/**
 * Feature registry. `source` points at the fork that ships with Fx; `enable`
 * copies it into the project so the project owns (and pins) the bytes.
 */
export const FEATURES = {
  temporaryvariables: {
    name: "temporaryvariables",
    title: "Temporary Variables",
    summary: "Disposable per-thread and per-run variables.",
    extensionId: "fxTempVars",
    filename: "fx-tempvars.js",
    source: fileURLToPath(
      new URL("../vendor/tempvars/fx-tempvars.js", import.meta.url),
    ),
  },
};

/** List feature names for help and error messages. */
export function featureNames() {
  return Object.keys(FEATURES).sort();
}

/** Resolve one feature by name. */
export function getFeature(name) {
  const key = String(name ?? "");
  const feature = FEATURES[key];
  if (!feature)
    throw new FeatureError(
      `Unknown feature ${JSON.stringify(key)}. Available features: ${featureNames().join(", ")}.`,
    );
  return feature;
}

/** Absolute path of the extension source Fx ships for a feature. */
export function featureSourcePath(name) {
  return getFeature(name).source;
}

/** Read the packaged feature source. */
export function readFeatureSource(name) {
  const feature = getFeature(name);
  try {
    return fs.readFileSync(feature.source);
  } catch (error) {
    throw new FeatureError(
      `Could not read the bundled source for ${feature.title}: ${error.message}`,
      { cause: error },
    );
  }
}

function posix(value) {
  return String(value).replace(/\\/g, "/");
}

/** Relative, project-facing path with a leading `./`. */
function relativeProjectPath(configDir, file) {
  const rel = posix(path.relative(configDir, file));
  if (rel === "") return ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Refuse paths that escape the project directory. */
function assertInside(configDir, target, label) {
  const base = path.resolve(configDir);
  const absolute = path.resolve(target);
  const rel = path.relative(base, absolute);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    throw new FeatureError(
      `Refusing to use ${label} ${JSON.stringify(absolute)}: it must be inside the project directory`,
    );
  return absolute;
}

/** Replace a file atomically so an interrupted write cannot truncate it. */
function writeFileAtomic(file, data) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, data, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Read the `features:` list from a config file. */
function readFeatureEntries(configPath) {
  return parseConfig(fs.readFileSync(configPath, "utf8")).features;
}

/**
 * Install a feature into a project: copy the packaged extension to the vendor
 * directory and record the file under `features:`.
 *
 * @param {object} options
 * @param {string} options.configPath
 * @param {string} options.configDir
 * @param {string} options.name
 * @param {string} [options.vendorDir]
 * @param {boolean} [options.force] replace a modified copy
 * @returns {{feature: object, name: string, file: string, path: string, changed: boolean, configChanged: boolean}}
 */
export function enableFeature({
  configPath,
  configDir,
  name,
  vendorDir = "extensions",
  force = false,
} = {}) {
  const feature = getFeature(name);
  const dir = assertInside(
    configDir,
    path.resolve(configDir, String(vendorDir || "extensions")),
    "feature directory",
  );
  const target = path.join(dir, feature.filename);
  const source = readFeatureSource(feature.name);
  const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const changed = !existing || !existing.equals(source);
  if (existing && changed && !force)
    throw new FeatureError(
      `${feature.title} is already installed at ${relativeProjectPath(
        configDir,
        target,
      )} with different contents. Run "fx feature ${feature.name} update" to replace it.`,
    );

  if (changed) {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(target, source);
  }
  const file = relativeProjectPath(configDir, target);
  const configured = readFeatureEntries(configPath).find(
    (entry) => entry.name === feature.name,
  );
  const needsEntry = !configured || configured.file !== file;
  if (needsEntry) addFeatureEntry(configPath, feature.name, file);
  return {
    feature,
    name: feature.name,
    file,
    path: target,
    changed,
    configChanged: needsEntry,
  };
}

/**
 * Remove a feature from `fx.yml` and delete the copy Fx installed.
 *
 * Only the known feature filename is deleted, so a hand-pointed entry cannot
 * make this command delete an unrelated project file.
 */
export function disableFeature({ configPath, configDir, name } = {}) {
  const feature = getFeature(name);
  const entry = readFeatureEntries(configPath).find(
    (candidate) => candidate.name === feature.name,
  );
  if (!entry)
    throw new FeatureError(
      `${feature.title} is not enabled. Run "fx feature ${feature.name} enable" first.`,
    );

  const target = assertInside(
    configDir,
    path.resolve(configDir, entry.file),
    "feature file",
  );
  const managed = path.basename(target) === feature.filename;
  const fileExists = managed && fs.existsSync(target);
  removeFeatureEntry(configPath, feature.name);
  if (fileExists) fs.rmSync(target, { force: true });
  return {
    feature,
    name: feature.name,
    file: entry.file,
    fileRemoved: fileExists,
  };
}

/**
 * Replace a project's feature copy with the one bundled in this Fx version.
 * Nothing changes unless this command (or `enable --force`) runs.
 */
export function updateFeature({
  configPath,
  configDir,
  name,
  dryRun = false,
} = {}) {
  const feature = getFeature(name);
  const entry = readFeatureEntries(configPath).find(
    (candidate) => candidate.name === feature.name,
  );
  if (!entry)
    throw new FeatureError(
      `${feature.title} is not enabled. Run "fx feature ${feature.name} enable" first.`,
    );

  const target = assertInside(
    configDir,
    path.resolve(configDir, entry.file),
    "feature file",
  );
  const after = readFeatureSource(feature.name);
  const before = fs.existsSync(target)
    ? fs.readFileSync(target)
    : Buffer.alloc(0);
  if (before.equals(after))
    return {
      feature,
      name: feature.name,
      file: entry.file,
      changed: false,
      dryRun: Boolean(dryRun),
      diff: "",
    };

  const diff = formatDiff(
    before.toString("utf8"),
    after.toString("utf8"),
    entry.file,
  );
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, after);
  }
  return {
    feature,
    name: feature.name,
    file: entry.file,
    changed: true,
    dryRun: Boolean(dryRun),
    diff,
  };
}

/**
 * Load every configured feature extension.
 * @returns {Promise<{catalog: Record<string, object>, extensionUrls: Record<string, string>, warnings: string[], ids: string[], unsandboxed: string[]}>}
 */
export async function loadFeatureExtensions({ configDir, config } = {}) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  const ids = [];
  const unsandboxed = [];

  for (const entry of config?.features || []) {
    const absolute = path.resolve(configDir, entry.file);
    if (!fs.existsSync(absolute)) {
      warnings.push(
        `feature "${entry.name}": ${entry.file} is missing; run "fx feature ${entry.name} enable"`,
      );
      continue;
    }
    const loaded = await loadExtensions([absolute], {
      baseDir: configDir,
      reportUnmatchedUnsandboxed: false,
    });
    Object.assign(catalog, loaded.catalog);
    Object.assign(extensionUrls, loaded.extensionUrls);
    warnings.push(...loaded.warnings);
    ids.push(...loaded.ids);
    unsandboxed.push(...loaded.unsandboxed);
  }

  return { catalog, extensionUrls, warnings, ids, unsandboxed };
}
