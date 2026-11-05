/**
 * Vendored extension support.
 *
 * `fx.yml` can declare extensions under `vendor:`; their source is committed
 * under `extensions/` (or `vendorDir`) and recorded in `fx.lock`. Builds load
 * the vendored copy, so extension URLs never need to be reachable after the
 * first install, and the archive embeds verified source instead of a URL.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { DEFAULT_VENDOR_DIR, normalizeVendorEntry } from "./config.js";
import {
  addVendorEntry,
  extensionKey,
  removeProjectExtensions,
  removeVendorEntry,
} from "./config-edit.js";
import {
  inspectExtension,
  loadExtensions,
  readExtensionDataUri,
  resolveSource,
} from "./extensions.js";

export const LOCK_FILENAME = "fx.lock";
export const LOCK_VERSION = 1;

export class VendorError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "VendorError";
  }
}

/** @param {Buffer|string} value */
export function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value)))
    .digest("hex");
}

export function isRemoteSource(source) {
  return /^https?:\/\//i.test(String(source));
}

export function isDataSource(source) {
  return /^data:/i.test(String(source));
}

/** Resolve the configured vendor directory against the config directory. */
export function vendorDirPath(configDir, config = {}) {
  const configured =
    (typeof config === "string" ? config : config?.vendorDir) ||
    config?.fx?.vendorDir ||
    DEFAULT_VENDOR_DIR;
  return path.resolve(configDir, String(configured));
}

/** Path relative to the config directory, using forward slashes. */
export function relativeVendorPath(configDir, file) {
  return path.relative(configDir, file).split(path.sep).join("/");
}

/** Normalize a path string to forward slashes for lock/config records. */
function posix(value) {
  return String(value).replace(/\\/g, "/");
}

/** A safe file stem for an extension name. */
export function vendorFileStem(name) {
  return (
    String(name)
      .replace(/\.js$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "extension"
  );
}

/** Pick a name from a URL or path, like `signals` for `.../signals.js`. */
export function defaultVendorName(source) {
  if (isDataSource(source)) return "extension";
  const clean = String(source).split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || "";
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // Keep the raw basename when it is not valid percent-encoding.
  }
  const stem = decoded
    .replace(/\.js$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return stem || "extension";
}

/** Make a proposed name unique by appending a numeric suffix. */
export function uniqueVendorName(name, used) {
  const base = String(name) || "extension";
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** True when a mapping looks like a lock entry rather than metadata. */
function looksLikeLockEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["source", "url", "path", "file", "sha256", "hash", "integrity"].some(
    (key) => Object.hasOwn(value, key),
  );
}

/** Normalize legacy lock-entry spellings into the current shape. */
function normalizeLockEntry(name, raw) {
  const file = raw.file ?? raw.vendored ?? raw.vendorFile ?? raw.vendor_path;
  const source = raw.source ?? raw.url ?? raw.sourcePath ?? raw.source_path;
  return {
    name: String(raw.name ?? name),
    source: source == null ? null : String(source),
    file: file == null ? null : posix(file),
    sha256: raw.sha256 ?? raw.hash ?? raw.integrity ?? null,
    fetched:
      raw.fetched ?? raw.time ?? raw.installedAt ?? raw.fetchedAt ?? null,
    remote:
      raw.remote != null
        ? Boolean(raw.remote)
        : source != null
          ? isRemoteSource(source)
          : undefined,
    local: raw.local != null ? Boolean(raw.local) : undefined,
    volatile: raw.volatile != null ? Boolean(raw.volatile) : undefined,
    etag: raw.etag ?? null,
    lastModified: raw.lastModified ?? raw.last_modified ?? null,
  };
}

/**
 * Read `fx.lock`. Missing files are an empty lock, not an error.
 * @param {string} configDir
 * @returns {{version: number, extensions: Record<string, object>, path: string}}
 */
export function readLock(configDir) {
  const file = path.join(configDir, LOCK_FILENAME);
  if (!fs.existsSync(file))
    return { version: LOCK_VERSION, extensions: {}, path: file };

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(file, "utf8")) ?? {};
  } catch (error) {
    throw new VendorError(`Could not read ${LOCK_FILENAME}: ${error.message}`, {
      cause: error,
    });
  }
  if (typeof parsed !== "object" || Array.isArray(parsed))
    throw new VendorError(`${LOCK_FILENAME} must contain a mapping`);

  const extensions = {};
  const nested = parsed.extensions ?? parsed.vendor ?? parsed.entries;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [name, entry] of Object.entries(nested))
      if (entry && typeof entry === "object")
        extensions[name] = normalizeLockEntry(name, entry);
  } else {
    // Also accept a lock whose entries are top-level keys.
    for (const [name, entry] of Object.entries(parsed)) {
      if (["version", "lockfileVersion", "schema", "packages"].includes(name))
        continue;
      if (looksLikeLockEntry(entry))
        extensions[name] = normalizeLockEntry(name, entry);
    }
  }

  return {
    version: Number(parsed.version ?? parsed.lockfileVersion ?? LOCK_VERSION),
    extensions,
    path: file,
  };
}

/**
 * Write `fx.lock` as JSON (which is also valid YAML).
 * @param {string} configDir
 * @param {{version?: number, extensions: Record<string, object>}} lock
 */
export function writeLock(configDir, lock) {
  const file = path.join(configDir, LOCK_FILENAME);
  const out = { version: lock.version ?? LOCK_VERSION, extensions: {} };
  for (const [name, entry] of Object.entries(lock.extensions || {})) {
    const clean = {
      name,
      source: entry.source ?? null,
      file: entry.file ? posix(entry.file) : null,
      sha256: entry.sha256 ?? null,
      fetched: entry.fetched ?? null,
      remote: Boolean(entry.remote),
      local: Boolean(entry.local),
      volatile: Boolean(entry.volatile),
    };
    if (entry.etag) clean.etag = entry.etag;
    if (entry.lastModified) clean.lastModified = entry.lastModified;
    out.extensions[name] = clean;
  }
  writeFileAtomic(file, `${JSON.stringify(out, null, 2)}\n`);
  return file;
}

/** Add the generated-from header used for copied local extensions. */
function localVendoredContent(entry, buffer) {
  const header = `// generated from ${entry.source}, do not edit\n`;
  return Buffer.concat([Buffer.from(header, "utf8"), buffer]);
}

/** Apply source-specific storage rules before hashing or writing. */
function storedContent(entry, buffer) {
  return entry.local ? localVendoredContent(entry, buffer) : buffer;
}

/** Read a local/data source and return its bytes plus resolved file. */
function readLocalSource(entry, configDir) {
  if (entry.data) {
    const source = readExtensionDataUri(entry.source);
    if (source == null) throw new VendorError("unsupported data URI");
    return { buffer: Buffer.from(source, "utf8"), file: null };
  }
  const file = path.isAbsolute(entry.source)
    ? entry.source
    : path.resolve(configDir, entry.source);
  try {
    return { buffer: fs.readFileSync(file), file };
  } catch (error) {
    throw new VendorError(
      `Could not read local extension ${entry.source}: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * Read a configured source, either from disk/data URI or over HTTP.
 * @returns {Promise<{buffer: Buffer, extra: object}>}
 */
async function readEntrySource(entry, configDir, fetchImpl) {
  if (entry.local || entry.data)
    return { buffer: readLocalSource(entry, configDir).buffer, extra: {} };
  const fetched = await fetchVendorSource(entry.source, { fetchImpl });
  return {
    buffer: fetched.buffer,
    extra: { etag: fetched.etag, lastModified: fetched.lastModified },
  };
}

/** Build conditional request headers when the lock has validators. */
function fetchOptions(etag, lastModified) {
  const headers = {};
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  return Object.keys(headers).length ? { headers } : undefined;
}

/**
 * Fetch an extension over HTTP.
 * @returns {Promise<{buffer: Buffer, etag: string|null, lastModified: string|null, notModified: boolean}>}
 */
export async function fetchVendorSource(
  source,
  { fetchImpl, etag, lastModified } = {},
) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function")
    throw new VendorError("global fetch is unavailable");
  let response;
  try {
    response = await fetchFn(source, fetchOptions(etag, lastModified));
  } catch (error) {
    throw new VendorError(`Could not download ${source}: ${error.message}`, {
      cause: error,
    });
  }
  if (response.status === 304)
    return {
      buffer: null,
      etag: response.headers?.get?.("etag") ?? etag ?? null,
      lastModified:
        response.headers?.get?.("last-modified") ?? lastModified ?? null,
      notModified: true,
    };
  if (!response.ok) {
    const status = `${response.status} ${response.statusText ?? ""}`.trim();
    throw new VendorError(`Could not download ${source}: HTTP ${status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    etag: response.headers?.get?.("etag") ?? null,
    lastModified: response.headers?.get?.("last-modified") ?? null,
    notModified: false,
  };
}

/**
 * Reject paths whose existing components include a symbolic link. Walking the
 * components prevents a lock path from escaping through a linked parent.
 */
function assertNoSymlinkPath(start, target, relative) {
  const base = path.resolve(start);
  const absolute = path.resolve(target);
  const suffix = path.relative(base, absolute);
  if (
    suffix === "" ||
    suffix === ".." ||
    suffix.startsWith(`..${path.sep}`) ||
    path.isAbsolute(suffix)
  )
    return;
  let current = base;
  for (const part of suffix.split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink())
      throw new VendorError(
        `Refusing to access ${relative}: ${path.relative(
          base,
          current,
        )} is a symbolic link`,
      );
  }
}

/** Resolve a relative vendor path and enforce the filesystem boundary. */
function ensureVendorTarget(configDir, vendorDir, relative) {
  const root = path.resolve(vendorDir);
  const rootInside = path.relative(path.resolve(configDir), root);
  if (
    rootInside === "" ||
    rootInside === ".." ||
    rootInside.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rootInside)
  )
    throw new VendorError(
      `Refusing to access vendor directory ${root}: it must be inside the project directory`,
    );
  const absolute = path.resolve(configDir, relative);
  const inside = path.relative(root, absolute);
  if (
    inside === ".." ||
    inside.startsWith(`..${path.sep}`) ||
    path.isAbsolute(inside)
  )
    throw new VendorError(
      `Refusing to write ${relative}: it is outside ${relativeVendorPath(
        configDir,
        root,
      )}`,
    );
  // Resolve links as well as lexical traversal: a project-controlled lock path
  // must not escape the vendor directory through a symlinked ancestor.
  assertNoSymlinkPath(configDir, root, relative);
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (rootStat?.isSymbolicLink())
    throw new VendorError(
      `Refusing to access ${relative}: ${relativeVendorPath(
        configDir,
        root,
      )} is a symbolic link`,
    );
  assertNoSymlinkPath(root, absolute, relative);
  return absolute;
}

/** Reject a build/restore when the configured source no longer matches. */
function assertLockSource(entry, lockEntry) {
  if (!lockEntry?.source || lockEntry.source === entry.source) return;
  throw new VendorError(
    `extension "${entry.name}": source changed from ${JSON.stringify(
      lockEntry.source,
    )} to ${JSON.stringify(entry.source)}; run "fx vendor update ${entry.name}"`,
  );
}

/** Allocate a collision-free, non-existing file name for a vendor entry. */
function chooseVendorFile(
  configDir,
  vendorDir,
  name,
  lock,
  reserved = new Set(),
) {
  const used = new Set(
    Object.values(lock?.extensions || {})
      .map((entry) => entry.file)
      .filter(Boolean),
  );
  for (const file of reserved) used.add(posix(file));
  const base = vendorFileStem(name);
  for (let suffix = 1; ; suffix += 1) {
    const stem = suffix === 1 ? base : `${base}-${suffix}`;
    const relative = posix(
      path.join(relativeVendorPath(configDir, vendorDir), `${stem}.js`),
    );
    if (used.has(relative)) continue;
    // Never allocate a path that already exists on disk: untracked files are
    // not ours to overwrite.
    if (fs.existsSync(path.resolve(configDir, relative))) continue;
    return relative;
  }
}

/**
 * Pick the vendored file for every configured entry, reusing lock paths and
 * allocating collision-free names for entries that are not locked yet.
 *
 * @returns {Map<string, {file: string, lockEntry: object|null}>}
 */
export function resolveVendorFiles(configDir, vendorDir, entries, lock) {
  const used = new Set(
    Object.values(lock?.extensions || {})
      .map((entry) => entry.file)
      .filter(Boolean),
  );
  const files = new Map();
  for (const entry of entries || []) {
    const lockEntry = lock?.extensions?.[entry.name] ?? null;
    let file = lockEntry?.file;
    if (!file) {
      file = chooseVendorFile(configDir, vendorDir, entry.name, lock, used);
      used.add(file);
    }
    files.set(entry.name, { file, lockEntry });
  }
  return files;
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

/**
 * Write a vendored file after checking containment, symlinks and ownership.
 * Untracked regular files are never overwritten unless the caller explicitly
 * identifies them as owned by the lock.
 */
function writeVendorFile(
  configDir,
  vendorDir,
  relative,
  buffer,
  { allowOverwrite = false } = {},
) {
  const absolute = ensureVendorTarget(configDir, vendorDir, relative);
  const existing = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (existing && !existing.isFile())
    throw new VendorError(
      `Refusing to write ${relative}: it is not a regular file`,
    );
  if (existing && !allowOverwrite)
    throw new VendorError(
      `Refusing to overwrite ${relative}: it is not recorded in ${LOCK_FILENAME}`,
    );
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileAtomic(absolute, buffer);
  return absolute;
}

/** Build the lock record for a source's stored bytes. */
function lockEntryForInstall(name, entry, file, buffer, extra = {}) {
  return {
    name,
    source: entry.source,
    file: posix(file),
    sha256: sha256(buffer),
    fetched: new Date().toISOString(),
    remote: Boolean(entry.remote),
    local: Boolean(entry.local),
    volatile: Boolean(entry.volatile),
    etag: extra.etag ?? null,
    lastModified: extra.lastModified ?? null,
  };
}

/**
 * Fetch or copy one extension and write it under the vendor directory.
 *
 * @param {object} options
 * @param {string} options.configPath
 * @param {string} options.configDir
 * @param {string} options.name
 * @param {string} options.source
 * @param {string} [options.vendorDir]
 * @param {object} [options.lock]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.unsandboxed]
 * @param {boolean} [options.volatile]
 * @returns {Promise<{entry: object, lockEntry: object, file: string}>}
 */
export async function installVendorEntry({
  configPath,
  configDir,
  name,
  source,
  vendorDir,
  lock,
  fetchImpl,
  unsandboxed,
  volatile,
}) {
  const dir = vendorDir
    ? path.resolve(configDir, vendorDir)
    : path.join(configDir, DEFAULT_VENDOR_DIR);
  const currentLock = lock || readLock(configDir);
  const entry = normalizeVendorEntry(String(name), {
    url: source,
    ...(unsandboxed ? { unsandboxed: true } : {}),
    ...(volatile != null ? { volatile } : {}),
  });

  let buffer;
  let extra = {};
  if (entry.remote) {
    const read = await readEntrySource(entry, configDir, fetchImpl);
    buffer = read.buffer;
    extra = read.extra;
  } else {
    buffer = readLocalSource(entry, configDir).buffer;
  }
  const stored = storedContent(entry, buffer);

  const previous = currentLock.extensions[name];
  const file =
    previous?.file || chooseVendorFile(configDir, dir, name, currentLock);
  const absolute = ensureVendorTarget(configDir, dir, file);
  const existing = fs.lstatSync(absolute, { throwIfNoEntry: false });
  const before = existing?.isFile() ? fs.readFileSync(absolute) : null;
  const configBefore = fs.readFileSync(configPath, "utf8");
  let wrote = false;

  try {
    writeVendorFile(configDir, dir, file, stored, {
      allowOverwrite: Boolean(previous),
    });
    wrote = true;
    addVendorEntry(configPath, name, entry.source, {
      unsandboxed: entry.unsandboxed,
      volatile: entry.volatile,
    });
    const lockEntry = lockEntryForInstall(name, entry, file, stored, extra);
    currentLock.extensions[name] = lockEntry;
    writeLock(configDir, currentLock);
    return { entry, lockEntry, file };
  } catch (error) {
    if (wrote) {
      if (before) fs.writeFileSync(absolute, before);
      else fs.rmSync(absolute, { force: true });
    }
    fs.writeFileSync(configPath, configBefore);
    throw error;
  }
}

/**
 * Install (or restore) every extension under `vendor:`.
 *
 * Existing files are verified and left alone; only missing remote files are
 * fetched. Local extensions are always re-copied from their source.
 */
export async function installVendor({ configDir, config, fetchImpl } = {}) {
  const entries = config?.vendor || [];
  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const files = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const warnings = [];
  const results = [];
  const backups = new Map();
  const remember = (absolute) => {
    if (backups.has(absolute)) return;
    const existing = fs.lstatSync(absolute, { throwIfNoEntry: false });
    backups.set(absolute, {
      existed: Boolean(existing),
      buffer: existing?.isFile() ? fs.readFileSync(absolute) : Buffer.alloc(0),
    });
  };

  try {
    for (const entry of entries) {
      const { file, lockEntry: previous } = files.get(entry.name);

      if (entry.local || entry.data) {
        const local = readLocalSource(entry, configDir);
        const stored = storedContent(entry, local.buffer);
        const absolute = ensureVendorTarget(configDir, vendorDir, file);
        remember(absolute);
        writeVendorFile(configDir, vendorDir, file, stored, {
          allowOverwrite: Boolean(previous),
        });
        lock.extensions[entry.name] = lockEntryForInstall(
          entry.name,
          entry,
          file,
          stored,
        );
        results.push({
          name: entry.name,
          file,
          status: entry.local ? "copied" : "verified",
        });
        continue;
      }

      const absolute = ensureVendorTarget(configDir, vendorDir, file);
      assertLockSource(entry, previous);
      if (fs.existsSync(absolute)) {
        const buffer = fs.readFileSync(absolute);
        const hash = sha256(buffer);
        if (previous?.sha256 && hash !== previous.sha256) {
          if (entry.volatile) {
            warnings.push(
              `extension "${entry.name}" changed in ${file}; volatile entry accepted`,
            );
            lock.extensions[entry.name] = {
              ...previous,
              sha256: hash,
              fetched: new Date().toISOString(),
            };
          } else {
            throw new VendorError(
              `extension "${entry.name}" in ${file} does not match ${LOCK_FILENAME}; ` +
                'the vendored copy changed. Run "fx vendor update ' +
                `${entry.name}" to accept it, or restore the file`,
            );
          }
        } else if (!previous?.sha256) {
          lock.extensions[entry.name] = lockEntryForInstall(
            entry.name,
            entry,
            file,
            buffer,
          );
        }
        results.push({ name: entry.name, file, status: "verified" });
        continue;
      }

      const read = await readEntrySource(entry, configDir, fetchImpl);
      const hash = sha256(read.buffer);
      if (previous?.sha256 && hash !== previous.sha256) {
        if (entry.volatile) {
          warnings.push(
            `extension "${entry.name}" changed upstream; volatile entry accepted`,
          );
        } else {
          throw new VendorError(
            `extension "${entry.name}" changed upstream while restoring ${LOCK_FILENAME}. ` +
              `Run "fx vendor update ${entry.name}" to accept the new source`,
          );
        }
      }
      remember(absolute);
      writeVendorFile(configDir, vendorDir, file, read.buffer, {
        allowOverwrite: Boolean(previous),
      });
      lock.extensions[entry.name] = lockEntryForInstall(
        entry.name,
        entry,
        file,
        read.buffer,
        read.extra,
      );
      results.push({ name: entry.name, file, status: "fetched" });
    }

    writeLock(configDir, lock);
  } catch (error) {
    for (const [absolute, backup] of backups) {
      if (backup.existed) fs.writeFileSync(absolute, backup.buffer);
      else fs.rmSync(absolute, { force: true });
    }
    throw error;
  }

  return { lock, warnings, entries: results };
}

/**
 * Re-fetch remote entries (or re-copy local ones) and update the lock.
 * Returns the changed entries and a textual diff for each.
 */
export async function updateVendor({
  configDir,
  config,
  name,
  fetchImpl,
  write = true,
} = {}) {
  const entries = config?.vendor || [];
  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const files = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const selected = name
    ? entries.filter((entry) => entry.name === String(name))
    : entries;
  if (name && selected.length === 0)
    throw new VendorError(
      `No vendored extension named ${JSON.stringify(name)}`,
    );

  const results = [];
  const warnings = [];
  const pending = [];
  let changed = 0;

  for (const entry of selected) {
    const { file, lockEntry } = files.get(entry.name);
    const absolute = ensureVendorTarget(configDir, vendorDir, file);
    const existed = fs.existsSync(absolute);
    const before = existed ? fs.readFileSync(absolute) : Buffer.alloc(0);

    let after;
    let extra = {};
    if (entry.local || entry.data) {
      after = storedContent(entry, readLocalSource(entry, configDir).buffer);
    } else {
      const read = await readEntrySource(entry, configDir, fetchImpl);
      after = read.buffer;
      extra = read.extra;
    }

    const different = !after.equals(before);
    const sourceChanged = lockEntry?.source !== entry.source;
    results.push({
      name: entry.name,
      file,
      changed: different,
      sourceChanged,
      diff: different
        ? formatDiff(before.toString("utf8"), after.toString("utf8"), file)
        : "",
    });
    if (!different && !sourceChanged) continue;
    if (different) changed += 1;
    pending.push({
      entry,
      file,
      absolute,
      existed,
      before,
      after,
      extra,
      different,
      lockEntry,
    });
  }

  if (write && pending.length > 0) {
    const backups = new Map();
    try {
      for (const item of pending) {
        if (!item.different) continue;
        backups.set(item.absolute, {
          existed: item.existed,
          buffer: item.before,
        });
        writeVendorFile(configDir, vendorDir, item.file, item.after, {
          allowOverwrite: Boolean(item.lockEntry),
        });
      }
      for (const item of pending)
        lock.extensions[item.entry.name] = lockEntryForInstall(
          item.entry.name,
          item.entry,
          item.file,
          item.after,
          item.extra,
        );
      writeLock(configDir, lock);
    } catch (error) {
      for (const [absolute, backup] of backups) {
        if (backup.existed) fs.writeFileSync(absolute, backup.buffer);
        else fs.rmSync(absolute, { force: true });
      }
      throw error;
    }
  }

  return { entries: results, warnings, changed, lock };
}

/**
 * Check vendored files against `fx.lock` without touching the network.
 * @returns {{ok: boolean, problems: string[], warnings: string[], entries: object[]}}
 */
export function verifyVendor({ configDir, config } = {}) {
  const entries = config?.vendor || [];
  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const files = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const problems = [];
  const warnings = [];
  const results = [];

  for (const entry of entries) {
    const { file, lockEntry } = files.get(entry.name);
    const absolute = ensureVendorTarget(configDir, vendorDir, file);
    if (!fs.existsSync(absolute)) {
      problems.push(`extension "${entry.name}": ${file} is missing`);
      results.push({ name: entry.name, file, status: "missing" });
      continue;
    }
    const buffer = fs.readFileSync(absolute);
    const hash = sha256(buffer);

    if (lockEntry && lockEntry.source !== entry.source) {
      problems.push(
        `extension "${entry.name}": source changed from ${JSON.stringify(
          lockEntry.source,
        )} to ${JSON.stringify(entry.source)}; run "fx vendor update ${entry.name}"`,
      );
      results.push({ name: entry.name, file, status: "source-changed", hash });
      continue;
    }

    if (entry.local || entry.data) {
      if (lockEntry?.sha256 && hash !== lockEntry.sha256) {
        warnings.push(
          `extension "${entry.name}": local copy differs from ${LOCK_FILENAME}; ` +
            'the hash is informational only (run "fx vendor install" to refresh it)',
        );
      }
      if (!entry.data) {
        const sourceFile = path.isAbsolute(entry.source)
          ? entry.source
          : path.resolve(configDir, entry.source);
        if (!fs.existsSync(sourceFile))
          problems.push(
            `extension "${entry.name}": local source ${entry.source} is missing`,
          );
      }
      results.push({ name: entry.name, file, status: "ok", hash });
      continue;
    }

    if (!lockEntry?.sha256) {
      problems.push(`extension "${entry.name}": no entry in ${LOCK_FILENAME}`);
      results.push({ name: entry.name, file, status: "unlocked", hash });
      continue;
    }
    if (hash !== lockEntry.sha256) {
      if (entry.volatile) {
        warnings.push(
          `extension "${entry.name}": ${file} differs from ${LOCK_FILENAME}; ` +
            "volatile entry accepted",
        );
        results.push({ name: entry.name, file, status: "volatile", hash });
      } else {
        problems.push(
          `extension "${entry.name}": ${file} does not match ${LOCK_FILENAME} ` +
            `(expected ${lockEntry.sha256.slice(0, 12)}…, found ${hash.slice(0, 12)}…)`,
        );
        results.push({ name: entry.name, file, status: "mismatch", hash });
      }
      continue;
    }
    results.push({ name: entry.name, file, status: "ok", hash });
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    entries: results,
  };
}

/**
 * Compare upstream sources with `fx.lock` without writing anything.
 * ETag/Last-Modified are sent when the lock has them.
 */
export async function outdatedVendor({ configDir, config, fetchImpl } = {}) {
  const entries = config?.vendor || [];
  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const files = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const results = [];

  for (const entry of entries) {
    const { file, lockEntry } = files.get(entry.name);
    if (entry.local || entry.data) {
      let after;
      try {
        after = storedContent(entry, readLocalSource(entry, configDir).buffer);
      } catch (error) {
        results.push({
          name: entry.name,
          status: "error",
          error: error.message,
        });
        continue;
      }
      results.push({
        name: entry.name,
        status:
          lockEntry?.sha256 && sha256(after) === lockEntry.sha256
            ? "current"
            : "outdated",
        file,
      });
      continue;
    }

    try {
      const fetched = await fetchVendorSource(entry.source, {
        fetchImpl,
        etag: lockEntry?.etag,
        lastModified: lockEntry?.lastModified,
      });
      if (fetched.notModified) {
        results.push({ name: entry.name, status: "current", file });
        continue;
      }
      results.push({
        name: entry.name,
        status:
          lockEntry?.sha256 && sha256(fetched.buffer) === lockEntry.sha256
            ? "current"
            : "outdated",
        file,
      });
    } catch (error) {
      results.push({
        name: entry.name,
        status: "error",
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Remove a vendored extension from fx.yml, the lock, and the vendor directory.
 */
export function removeVendoredExtension({
  configPath,
  configDir,
  config,
  name,
}) {
  const entries = config?.vendor || [];
  const target = String(name);
  const entry = entries.find((candidate) => candidate.name === target);
  if (!entry)
    throw new VendorError(
      `No vendored extension named ${JSON.stringify(name)}`,
    );

  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const files = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const { file } = files.get(target);
  const absolute = ensureVendorTarget(configDir, vendorDir, file);

  const result = removeVendorEntry(configPath, target);
  delete lock.extensions[target];
  writeLock(configDir, lock);

  const stillUsed = Object.values(lock.extensions).some(
    (candidate) => candidate.file === file,
  );
  if (!stillUsed) fs.rmSync(absolute, { force: true });

  return { entry, file, source: result.removed };
}

/**
 * Load every configured vendor entry from disk.
 *
 * Remote copies are checked against `fx.lock` before they are evaluated.
 * Missing files are restored from the lock when possible; local copies are
 * refreshed from their source path on every build.
 */
export async function loadVendorExtensions({
  configDir,
  config,
  fetchImpl,
} = {}) {
  const entries = config?.vendor || [];
  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const resolved = resolveVendorFiles(configDir, vendorDir, entries, lock);
  const warnings = [];
  const files = [];
  const lockChanged = { value: false };

  for (const entry of entries) {
    const { file, lockEntry } = resolved.get(entry.name);
    const absolute = ensureVendorTarget(configDir, vendorDir, file);

    if (entry.local || entry.data) {
      const local = readLocalSource(entry, configDir);
      const stored = storedContent(entry, local.buffer);
      const previous = fs.existsSync(absolute)
        ? fs.readFileSync(absolute)
        : null;
      const hash = sha256(stored);
      const needsWrite = !previous || !previous.equals(stored);
      const needsLock =
        !lockEntry ||
        lockEntry.sha256 !== hash ||
        lockEntry.source !== entry.source ||
        lockEntry.file !== file ||
        Boolean(lockEntry.local) !== Boolean(entry.local) ||
        Boolean(lockEntry.volatile) !== Boolean(entry.volatile);
      if (needsWrite)
        writeVendorFile(configDir, vendorDir, file, stored, {
          allowOverwrite: Boolean(lockEntry),
        });
      if (needsWrite || needsLock) {
        lock.extensions[entry.name] = lockEntryForInstall(
          entry.name,
          entry,
          file,
          stored,
        );
        lockChanged.value = true;
      }
      files.push({ entry, file, absolute });
      continue;
    }

    assertLockSource(entry, lockEntry);
    let buffer;
    if (fs.existsSync(absolute)) {
      buffer = fs.readFileSync(absolute);
      const hash = sha256(buffer);
      if (lockEntry?.sha256 && hash !== lockEntry.sha256) {
        if (entry.volatile) {
          warnings.push(
            `extension "${entry.name}" changed in ${file}; volatile entry accepted`,
          );
        } else {
          throw new VendorError(
            `extension "${entry.name}" in ${file} does not match ${LOCK_FILENAME}; ` +
              'the vendored copy changed. Run "fx vendor update ' +
              `${entry.name}" to accept it, or restore the file`,
          );
        }
      } else if (!lockEntry?.sha256) {
        lock.extensions[entry.name] = lockEntryForInstall(
          entry.name,
          entry,
          file,
          buffer,
        );
        lockChanged.value = true;
      }
    } else {
      const read = await readEntrySource(entry, configDir, fetchImpl);
      const hash = sha256(read.buffer);
      if (lockEntry?.sha256 && hash !== lockEntry.sha256) {
        if (entry.volatile) {
          warnings.push(
            `extension "${entry.name}" changed upstream; volatile entry accepted`,
          );
        } else {
          throw new VendorError(
            `extension "${entry.name}" is missing and upstream content changed. ` +
              `Run "fx vendor update ${entry.name}" to accept the new source`,
          );
        }
      }
      buffer = read.buffer;
      writeVendorFile(configDir, vendorDir, file, buffer, {
        allowOverwrite: Boolean(lockEntry),
      });
      lock.extensions[entry.name] = lockEntryForInstall(
        entry.name,
        entry,
        file,
        buffer,
        read.extra,
      );
      lockChanged.value = true;
    }
    files.push({ entry, file, absolute });
  }

  if (lockChanged.value) writeLock(configDir, lock);

  const expectUnsandboxed = [
    ...(config?.project?.unsandboxed || []),
    ...files
      .filter(({ entry }) => entry.unsandboxed)
      .map(({ absolute }) => absolute),
  ];
  const loaded = await loadExtensions(
    files.map(({ absolute }) => absolute),
    {
      baseDir: configDir,
      fetchImpl,
      expectUnsandboxed,
      reportUnmatchedUnsandboxed: false,
    },
  );

  return {
    ...loaded,
    warnings: [...warnings, ...loaded.warnings],
    matchedUnsandboxed: loaded.matchedUnsandboxed,
    unnecessaryUnsandboxed: loaded.unnecessaryUnsandboxed,
    files: files.map(({ file }) => file),
    entries,
    lock,
    vendorDir: relativeVendorPath(configDir, vendorDir),
  };
}

/** A compact line diff, enough to review an extension or config change. */
export function formatDiff(before, after, filename = "") {
  const a = String(before).split(/\r?\n/);
  const b = String(after).split(/\r?\n/);
  const rows = a.length;
  const columns = b.length;
  // Keep very large extensions from allocating an enormous matrix.
  if (rows * columns > 4_000_000) {
    return `--- ${filename}\n+++ ${filename}\n@@ source changed @@\n`;
  }
  const table = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [`--- ${filename}`, `+++ ${filename}`];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`-${a[i]}`);
      i += 1;
    } else {
      lines.push(`+${b[j]}`);
      j += 1;
    }
  }
  while (i < rows) lines.push(`-${a[i++]}`);
  while (j < columns) lines.push(`+${b[j++]}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Move `project.extensions` into the vendor system.
 *
 * The config is backed up before it is changed. Names come from
 * `getInfo().id` when the extension can be inspected, otherwise from the
 * filename, with numeric suffixes for collisions. All downloaded/read source
 * is written before fx.yml changes; a failure restores the original fx.yml.
 */
export async function migrateProjectExtensions({
  configPath,
  configDir,
  config,
  fetchImpl,
  nameFor,
} = {}) {
  const legacy = config?.project?.extensions || [];
  if (legacy.length === 0)
    return {
      migrated: [],
      backup: null,
      diff: "",
      warnings: [],
      configPath,
    };

  const dirName = config?.vendorDir || DEFAULT_VENDOR_DIR;
  const vendorDir = path.resolve(configDir, dirName);
  const lock = readLock(configDir);
  const used = new Set((config?.vendor || []).map((entry) => entry.name));
  const warnings = [];
  const prepared = [];

  // Resolve everything before touching fx.yml, so a broken URL cannot leave the
  // project with a partially migrated extension list.
  for (const source of new Set(legacy.map(String))) {
    let resolved;
    try {
      resolved = await resolveSource(source, configDir, fetchImpl);
    } catch (error) {
      throw new VendorError(
        `Could not vendor ${source}: ${error.message}; fx.yml was not changed`,
        { cause: error },
      );
    }

    let proposed = extensionKey(source);
    let needsUnsandboxed = false;
    try {
      const info = await inspectExtension(
        resolved.source,
        resolved.remote ? resolved.url : (resolved.file ?? "extension"),
      );
      if (info.infos[0]?.id) proposed = String(info.infos[0].id);
      needsUnsandboxed = Boolean(info.unsandboxed);
    } catch (error) {
      warnings.push(
        `could not inspect ${source}: ${error.message}; using the filename`,
      );
    }
    prepared.push({ source, resolved, proposed, needsUnsandboxed });
  }

  const items = [];
  for (const item of prepared) {
    let name = uniqueVendorName(item.proposed || "extension", used);
    if (typeof nameFor === "function") {
      const edited = await nameFor(name, item.source);
      if (edited && String(edited).trim())
        name = uniqueVendorName(String(edited).trim(), used);
    }
    used.add(name);
    const entry = normalizeVendorEntry(name, {
      url: item.source,
      ...(item.needsUnsandboxed ? { unsandboxed: true } : {}),
    });
    items.push({ ...item, name, entry });
  }

  const original = fs.readFileSync(configPath, "utf8");
  const backup = `${configPath}.bak`;
  fs.writeFileSync(backup, original);
  const lockPath = path.join(configDir, LOCK_FILENAME);
  const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;

  const migrated = [];
  const written = [];
  try {
    for (const item of items) {
      const buffer =
        item.resolved.buffer ?? Buffer.from(item.resolved.source, "utf8");
      const stored = storedContent(item.entry, buffer);
      const file = chooseVendorFile(configDir, vendorDir, item.name, lock);
      const absolute = ensureVendorTarget(configDir, vendorDir, file);
      const existing = fs.lstatSync(absolute, { throwIfNoEntry: false });
      const existed = Boolean(existing);
      const before = existing?.isFile() ? fs.readFileSync(absolute) : null;
      writeVendorFile(configDir, vendorDir, file, stored);
      written.push({ absolute, existed, before });
      lock.extensions[item.name] = lockEntryForInstall(
        item.name,
        item.entry,
        file,
        stored,
      );
      migrated.push({ name: item.name, source: item.source, file });
    }

    for (const item of items)
      addVendorEntry(configPath, item.name, item.source, {
        unsandboxed: item.entry.unsandboxed,
        volatile: item.entry.volatile,
      });
    removeProjectExtensions(configPath);
    writeLock(configDir, lock);
  } catch (error) {
    fs.writeFileSync(configPath, original);
    for (const { absolute, existed, before } of written.reverse()) {
      if (existed && before) fs.writeFileSync(absolute, before);
      else if (!existed) fs.rmSync(absolute, { force: true });
    }
    if (lockBefore) fs.writeFileSync(lockPath, lockBefore);
    else fs.rmSync(lockPath, { force: true });
    throw error;
  }

  const updated = fs.readFileSync(configPath, "utf8");
  return {
    migrated,
    backup,
    diff: formatDiff(original, updated, path.basename(configPath)),
    warnings,
    configPath,
  };
}
