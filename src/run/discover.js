/**
 * Run-file discovery.
 *
 * Run files use the same glob rules as test files, so both share the matcher
 * and walker. They are never part of the project target.
 */
import { discoverTests } from "../test/discover.js";
import { DEFAULT_RUN_PATTERN } from "./pattern.js";

export { DEFAULT_RUN_PATTERN };

/**
 * Find every run file under a directory.
 *
 * @param {{dir: string, pattern?: string, extension?: string}} options
 * @returns {Array<{file: string, relative: string}>} sorted by path
 */
export function discoverRuns({
  dir,
  pattern = DEFAULT_RUN_PATTERN,
  extension = ".tfx",
} = {}) {
  return discoverTests({ dir, pattern, extension });
}
