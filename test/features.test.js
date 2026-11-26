import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import {
  FEATURES,
  featureEnabled,
  featureNames,
  migrateFeatureConfig,
} from "../src/features.js";
import { disableFeature, enableFeature } from "../src/features.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

function project(text = 'project:\n  name: "Demo"\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-features-"));
  const configPath = path.join(dir, "fx.yml");
  fs.writeFileSync(configPath, text);
  return { dir, configPath };
}

test("the registry lists every optional feature once", () => {
  assert.deepEqual(featureNames(), [
    "partialSprites",
    "run",
    "temporaryvariables",
    "tests",
  ]);
  for (const name of featureNames()) {
    assert.equal(FEATURES[name].name, name);
    assert.equal(
      FEATURES[name].kind,
      FEATURES[name].core ? "core" : "extension",
    );
  }
});

test("fx.features wins over the older fx.<name> settings", () => {
  const { fx } = parseConfig(`
fx:
  partialSprites: true
  tests: true
  run:
    timeout: 100
  features:
    partialSprites: false
    tests: false
    run:
      timeout: 900
`);
  assert.equal(fx.partialSprites, false);
  assert.equal(fx.tests, false);
  assert.equal(fx.run.timeout, 900);
});

test("extension features can be declared under fx.features", () => {
  const { features } = parseConfig(`
fx:
  vendorDir: libs
  features:
    temporaryvariables: true
`);
  assert.deepEqual(features, [
    { name: "temporaryvariables", file: "./libs/fx-tempvars.js" },
  ]);
});

test("partialSprites uses the same enable and disable path as other features", () => {
  const { dir, configPath } = project();
  try {
    assert.equal(featureEnabled({ configPath, name: "partialSprites" }), false);
    assert.equal(
      enableFeature({ configPath, configDir: dir, name: "partialSprites" })
        .changed,
      true,
    );
    assert.equal(featureEnabled({ configPath, name: "partialSprites" }), true);
    assert.match(
      fs.readFileSync(configPath, "utf8"),
      /features:\n {4}partialSprites: true/,
    );

    disableFeature({ configPath, configDir: dir, name: "partialSprites" });
    assert.equal(featureEnabled({ configPath, name: "partialSprites" }), false);
    assert.match(
      fs.readFileSync(configPath, "utf8"),
      /features:\n {4}partialSprites: false/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx feature list and status report the centralized setting", () => {
  const { dir } = project(
    'project:\n  name: "Demo"\nfx:\n  features:\n    tests: true\n',
  );
  try {
    const list = spawnSync(process.execPath, [bin, "feature", "list"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /tests\s+enabled/);
    assert.match(list.stdout, /partialSprites\s+disabled/);

    const status = spawnSync(process.execPath, [bin, "feature", "tests"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /fx\.features\.tests/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migrateFeatureConfig moves legacy settings under fx.features", () => {
  const { dir, configPath } = project(`project:
  name: "Demo"

fx:
  partialSprites: true
  tests:
    timeout: 500
  run: true

features:
  temporaryvariables: ./extensions/fx-tempvars.js
`);
  try {
    const before = parseConfig(fs.readFileSync(configPath, "utf8"));
    const result = migrateFeatureConfig({ configPath });
    assert.equal(result.changed, true);
    assert.deepEqual(result.migrated.sort(), [
      "partialSprites",
      "run",
      "temporaryvariables",
      "tests",
    ]);
    assert.ok(fs.existsSync(result.backup));

    const text = fs.readFileSync(configPath, "utf8");
    assert.doesNotMatch(text, /^ {2}(tests|run|partialSprites):/m);
    assert.doesNotMatch(text, /^features:/m);
    const after = parseConfig(text);
    assert.equal(after.fx.partialSprites, before.fx.partialSprites);
    assert.deepEqual(after.fx.tests, before.fx.tests);
    assert.deepEqual(after.fx.run, before.fx.run);
    assert.deepEqual(after.features, before.features);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration keeps a value already set under fx.features", () => {
  const { dir, configPath } = project(`
fx:
  tests: false
  features:
    tests: true
`);
  try {
    const result = migrateFeatureConfig({ configPath });
    assert.equal(result.changed, true);
    const text = fs.readFileSync(configPath, "utf8");
    assert.doesNotMatch(text, /^ {2}tests:/m);
    assert.equal(parseConfig(text).fx.tests.enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("feature updates ignore comment-only lines when finding entries", () => {
  const { dir, configPath } = project(`project:
  name: "Demo"

fx:
  features:
      # indented deeper than the entries below
    tests: false
`);
  try {
    enableFeature({ configPath, configDir: dir, name: "tests" });
    const text = fs.readFileSync(configPath, "utf8");
    assert.equal((text.match(/^\s*tests:/gm) ?? []).length, 1);
    assert.equal(parseConfig(text).fx.tests.enabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration leaves core-named top-level feature entries in place", () => {
  const { dir, configPath } = project(`project:
  name: "Demo"

fx:
  tests: true

features:
  tests: ./extensions/tests.js
  temporaryvariables: ./extensions/fx-tempvars.js
`);
  try {
    const before = parseConfig(fs.readFileSync(configPath, "utf8"));
    const result = migrateFeatureConfig({ configPath });
    assert.deepEqual(result.conflicts, ["tests"]);
    const text = fs.readFileSync(configPath, "utf8");
    assert.match(text, /^features:\n {2}tests: \.\/extensions\/tests\.js/m);
    assert.doesNotMatch(text, /^ {2}temporaryvariables:/m);
    const after = parseConfig(text);
    assert.deepEqual(after.fx.tests, before.fx.tests);
    assert.deepEqual(after.features, before.features);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration reports a lone core-named legacy entry without changes", () => {
  const { dir, configPath } = project(`project:
  name: "Demo"

features:
  tests: ./extensions/tests.js
`);
  try {
    const original = fs.readFileSync(configPath, "utf8");
    const result = migrateFeatureConfig({ configPath });
    assert.equal(result.changed, false);
    assert.deepEqual(result.migrated, []);
    assert.deepEqual(result.conflicts, ["tests"]);
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit fx.features false drops a matching legacy feature", () => {
  const { features } = parseConfig(`
features:
  temporaryvariables: ./extensions/custom-tempvars.js
fx:
  features:
    temporaryvariables: false
`);
  assert.deepEqual(features, []);
});

test("fx feature migrate reports a no-op when there is nothing legacy", () => {
  const { dir } = project();
  try {
    const result = spawnSync(process.execPath, [bin, "feature", "migrate"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No legacy feature settings/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
