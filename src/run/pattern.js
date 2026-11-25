/**
 * Run-file globs.
 *
 * Kept separate from the matcher so the build, the CLI and editor tooling can
 * agree on which sources are entry points rather than project code.
 */

/** Default run-entry glob, relative to the project directory. */
export const DEFAULT_RUN_PATTERN = "run/**/*.run.tfx";
