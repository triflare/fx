import path from "node:path";
import { configFilename } from "../../../brand.js";
import { findConfigPath, loadConfigFrom } from "../../../config.js";
import { resolveVendorFiles } from "../../../vendor.js";
import { UsageError } from "../../errors.js";

/** Find the project config or explain how to create one. */
export function requireConfigPath(cwd, product) {
  const found = findConfigPath(cwd);
  if (!found)
    throw new UsageError(`No ${configFilename(product)} found.`, {
      hint: `run "${product?.command ?? "fx"} init" first`,
    });
  return found;
}

export function loadVendorConfig(configPath) {
  return loadConfigFrom(path.dirname(configPath));
}

/** Turn a command-line local path into a path relative to the config file. */
export function vendorConfigSource(source, configDir, cwd = process.cwd()) {
  if (/^https?:\/\//i.test(source) || /^data:/i.test(source)) return source;
  const absolute = path.isAbsolute(source)
    ? source
    : path.resolve(cwd, source);
  const relative = path.relative(configDir, absolute).split(path.sep).join("/");
  if (!relative) return ".";
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function vendorEntriesWithLock(loaded, lock, configDir) {
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
