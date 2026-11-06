/**
 * Multi-file project assembly.
 *
 * A Triflare Fx project can be spread across any number of `.tfx` files in a
 * directory tree. This module discovers those files and merges their ASTs into
 * a single `Program`, so the rest of the pipeline keeps working with one AST.
 */
import fs from "node:fs";
import path from "node:path";
import { configFilename, sourceExtension } from "./brand.js";
import { mergePrograms as mergeParsed } from "./merge.js";
import { DEFAULT_TEST_PATTERN, matchesTestPattern } from "./test/discover.js";

/** Directories never scanned for `.tfx` sources. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".cache",
]);

/**
 * Recursively find every `.tfx` file under `dir`, skipping hidden entries and
 * well-known build/dependency directories. Test files are skipped so they
 * never become part of the project target.
 *
 * Results are deterministic (sorted by path) so builds are reproducible.
 * @param {string} dir
 * @param {{testPattern?: string|null}} [options] `null` keeps test files
 * @returns {string[]} absolute file paths
 */
export function discoverSources(
  dir,
  { testPattern = DEFAULT_TEST_PATTERN } = {},
) {
  const root = path.resolve(dir);
  const found = [];
  const extension = sourceExtension().toLowerCase();

  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(extension)
      ) {
        if (testPattern) {
          const relative = path.relative(root, full).split(path.sep).join("/");
          if (matchesTestPattern(relative, testPattern)) continue;
        }
        found.push(full);
      }
    }
  };

  walk(root);
  return found.sort();
}

/**
 * Merge parsed programs into a single project AST.
 *
 * The merge itself is pure (see `merge.js`); this wrapper only injects the
 * configured config filename so project-facing errors keep the right name.
 *
 * @param {Array<{ast: object, file: string}>} entries
 * @param {{partialSprites?: boolean}} [options]
 * @returns {object} a `Program` node
 */
export function mergePrograms(entries, options = {}) {
  return mergeParsed(entries, {
    ...options,
    configName: configFilename(),
  });
}
