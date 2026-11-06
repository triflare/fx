/**
 * Browser-safe `fx.yml` reader for editor tooling.
 *
 * The full config loader (`src/config.js`) needs `node:fs` to search for the
 * file, so editors that only have the file's text use this instead. It reads
 * the settings lint diagnostics depend on — `fx.partialSprites`, `fx.lint` and
 * the declared extension names — and ignores everything else.
 */

import * as yaml from "js-yaml";
import { normalizeLintConfig } from "./config.js";

/** Extension name from a vendor path such as `extensions/signals.js`. */
function extensionName(source) {
  const base = String(source).split(/[\\/]/).pop() ?? "";
  return base.replace(/\.js$/i, "");
}

/**
 * @param {string} text raw `fx.yml`/`fx.yaml` contents
 * @returns {{
 *   config: {fx: {partialSprites: boolean}},
 *   lintConfig: object,
 *   declaredExtensions: string[],
 *   projectName: string|null,
 *   error?: string,
 * }}
 */
export function parseProjectConfigText(text) {
  let raw;
  try {
    raw = yaml.load(text) ?? {};
  } catch (error) {
    return {
      config: null,
      lintConfig: null,
      declaredExtensions: [],
      projectName: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      config: null,
      lintConfig: null,
      declaredExtensions: [],
      projectName: null,
      error: "fx.yml must contain a mapping at the top level",
    };
  }

  const fx =
    raw.fx && typeof raw.fx === "object" && !Array.isArray(raw.fx)
      ? raw.fx
      : {};
  const project =
    raw.project &&
    typeof raw.project === "object" &&
    !Array.isArray(raw.project)
      ? raw.project
      : {};

  let lintConfig;
  try {
    lintConfig = normalizeLintConfig(fx.lint ?? {});
  } catch (error) {
    return {
      config: null,
      lintConfig: null,
      declaredExtensions: [],
      projectName: typeof project.name === "string" ? project.name : null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const declaredExtensions = new Set();
  if (
    raw.vendor &&
    typeof raw.vendor === "object" &&
    !Array.isArray(raw.vendor)
  ) {
    for (const name of Object.keys(raw.vendor)) declaredExtensions.add(name);
  }
  if (Array.isArray(project.extensions)) {
    for (const source of project.extensions) {
      const name = extensionName(source);
      if (name) declaredExtensions.add(name);
    }
  }

  return {
    config: { fx: { partialSprites: Boolean(fx.partialSprites) } },
    lintConfig,
    declaredExtensions: [...declaredExtensions],
    projectName: typeof project.name === "string" ? project.name : null,
  };
}
