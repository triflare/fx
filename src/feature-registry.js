/**
 * The single registry of Fx's optional features.
 *
 * Every optional feature is described here, and only here. The `fx feature`
 * command, the `fx.features` config key, linting, and the build/test/run
 * pipelines all read this registry, so adding a feature does not mean teaching
 * each subsystem about it separately.
 *
 * A feature is either:
 *
 * - `core`: built into Fx and switched on by `fx.features.<name>`.
 * - `extension`: backed by a JavaScript extension that `fx feature enable`
 *   copies into the project, so the project owns (and pins) the source.
 */
import { fileURLToPath } from "node:url";

export class FeatureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FeatureError";
  }
}

export const FEATURES = {
  partialSprites: {
    name: "partialSprites",
    title: "Partial Sprites",
    summary: "Add to a sprite from more than one source file.",
    kind: "core",
    core: true,
  },
  run: {
    name: "run",
    title: "Running",
    summary: "Run headless entry points with `fx run`.",
    kind: "core",
    core: true,
    command: "run",
  },
  temporaryvariables: {
    name: "temporaryvariables",
    title: "Temporary Variables",
    summary: "Disposable per-thread and per-run variables.",
    kind: "extension",
    extensionId: "fxTempVars",
    filename: "fx-tempvars.js",
    source: fileURLToPath(
      new URL("../vendor/tempvars/fx-tempvars.js", import.meta.url),
    ),
  },
  tests: {
    name: "tests",
    title: "Testing",
    summary: "Write project tests and run them with `fx test`.",
    kind: "core",
    core: true,
    command: "test",
  },
};

/** Core features, kept as a derived view for older callers. */
export const CORE_FEATURES = Object.fromEntries(
  Object.entries(FEATURES).filter(([, feature]) => feature.core),
);

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

/** Core feature names. */
export function coreFeatureNames() {
  return featureNames().filter((name) => FEATURES[name].core);
}
