/**
 * Test-file discovery.
 *
 * Test files are ordinary `.tfx` sources that match a project glob. They are
 * never part of the project target, so both `fx test` and the normal build
 * path use the same matcher.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_TEST_PATTERN, matchesTestPattern } from "./pattern.js";

export {
  DEFAULT_TEST_PATTERN,
  globToRegExp,
  matchesTestPattern,
} from "./pattern.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".cache",
]);

/** Recursively collect test files below `current`, skipping ignored dirs. */
function walk(root, current, found, pattern, extension) {
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
      walk(root, full, found, pattern, extension);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (matchesTestPattern(relative, pattern)) found.push(full);
    }
  }
}

/**
 * Find every test file under a directory.
 *
 * @param {{dir: string, pattern?: string, extension?: string}} options
 * @returns {Array<{file: string, relative: string}>} sorted by path
 */
export function discoverTests({
  dir,
  pattern = DEFAULT_TEST_PATTERN,
  extension = ".tfx",
} = {}) {
  if (!dir) throw new Error("discoverTests needs a directory");
  const root = path.resolve(dir);
  const found = [];
  walk(root, root, found, pattern, String(extension).toLowerCase());
  found.sort();
  return found.map((file) => ({
    file,
    relative: path.relative(root, file).split(path.sep).join("/"),
  }));
}

/**
 * Whether one explicit path is a test file for a project directory.
 * @param {string} file
 * @param {string} dir
 * @param {string} [pattern]
 */
export function isTestFile(file, dir, pattern = DEFAULT_TEST_PATTERN) {
  const relative = path
    .relative(path.resolve(dir), path.resolve(file))
    .split(path.sep)
    .join("/");
  return matchesTestPattern(relative, pattern);
}
