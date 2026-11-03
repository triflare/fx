import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseConfig,
  normalizeProject,
  configPayload,
  configComment,
  findConfigPath,
  loadConfigFrom,
  normalizeFx,
  normalizePackage,
  normalizePackageTarget,
  DEFAULT_PROJECT,
  DEFAULT_FX,
  DEFAULT_PACKAGE,
  CONFIG_MAGIC,
} from "../src/config.js";

test("parses the spec fx.yml fixture", () => {
  const { project } = parseConfig(`
project:
  name: "Triflare Fx Adventure"
  fps: 60
  width: 480
  height: 360
  turbo: false
  interpolation: true
  extensions:
    - "./assets/extensions/signals.js"
    - "https://extensions.penguinmod.com/some/text.js"
  unsandboxed:
    - signals
`);
  assert.equal(project.name, "Triflare Fx Adventure");
  assert.equal(project.framerate, 60);
  assert.equal(project.interpolation, true);
  assert.deepEqual(project.extensions, [
    "./assets/extensions/signals.js",
    "https://extensions.penguinmod.com/some/text.js",
  ]);
  assert.deepEqual(project.unsandboxed, ["signals"]);
});

test("reads Fx-only settings from their own top-level mapping", () => {
  const { project, fx } = parseConfig(`
project:
  name: "Fragments"
fx:
  partialSprites: true
`);
  assert.equal(project.name, "Fragments");
  assert.equal(fx.partialSprites, true);
  assert.equal(DEFAULT_FX.partialSprites, false);
  assert.equal(normalizeFx({}).partialSprites, false);
  assert.equal(normalizeFx({ partialSprites: "yes" }).partialSprites, true);
});

test("rejects a non-mapping fx section", () => {
  assert.throws(
    () => parseConfig("fx: true\n"),
    /must contain an "fx" mapping/,
  );
});

test("reads packaging defaults and maps friendly target aliases", () => {
  const defaults = parseConfig("project:\n  name: Demo\n").package;
  assert.equal(defaults.target, DEFAULT_PACKAGE.target);
  assert.deepEqual(defaults.custom, { js: "", css: "", html: "" });
  assert.deepEqual(defaults.options, {});
  assert.equal(normalizePackageTarget("windows"), "electron-win64");
  assert.equal(normalizePackageTarget("mac"), "electron-mac");
  assert.equal(normalizePackageTarget("linux"), "electron-linux64");
  assert.equal(normalizePackageTarget("zip-one-asset"), "zip-one-asset");
  assert.equal(normalizePackageTarget("HTML"), "html");
});

test("normalizes package settings and keeps file references", () => {
  const { package: pkg } = parseConfig(`
package:
  target: windows
  output: dist/game.zip
  extract: true
  name: "My Game"
  version: "2.0.0"
  icon: assets/icon.png
  fps: 60
  width: 1280
  height: 720
  turbo: true
  custom:
    js: "console.log('hi')"
    css:
      file: src/custom.css
    html:
      file: src/custom.html
  options:
    autoplay: true
    app:
      windowTitle: "Raw title"
`);
  assert.equal(pkg.target, "electron-win64");
  assert.equal(pkg.output, "dist/game.zip");
  assert.equal(pkg.extract, true);
  assert.equal(pkg.name, "My Game");
  assert.equal(pkg.version, "2.0.0");
  assert.equal(pkg.icon, "assets/icon.png");
  assert.deepEqual(pkg.options, {
    framerate: 60,
    stageWidth: 1280,
    stageHeight: 720,
    turbo: true,
    autoplay: true,
    app: { windowTitle: "Raw title" },
  });
  assert.equal(pkg.custom.js, "console.log('hi')");
  assert.deepEqual(pkg.custom.css, { file: "src/custom.css" });
  assert.deepEqual(pkg.custom.html, { file: "src/custom.html" });
});

test("rejects unknown package settings and invalid custom values", () => {
  assert.throws(
    () => normalizePackage({ outpt: "typo.html" }),
    /unknown package setting/,
  );
  assert.throws(
    () => normalizePackage({ custom: { js: 42 } }),
    /must be text or \{ file: "<path>" \}/,
  );
  assert.throws(
    () => normalizePackage({ custom: { script: "x" } }),
    /unknown package\.custom setting/,
  );
  assert.throws(
    () => normalizePackage({ icon: true }),
    /package\.icon must be a file path/,
  );
});

test("loadConfigFrom includes packaging defaults when no file exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-empty-pkg-"));
  const { package: pkg } = loadConfigFrom(dir);
  assert.deepEqual(pkg, normalizePackage({}));
});

test("normalizes a single unsandboxed extension to a list", () => {
  assert.deepEqual(normalizeProject({ unsandboxed: "coolExt" }).unsandboxed, [
    "coolExt",
  ]);
  assert.deepEqual(normalizeProject({}).unsandboxed, []);
});

test("normalizes aliases and defaults", () => {
  const project = normalizeProject({ interpolate: true, hq: true });
  assert.equal(project.interpolation, true);
  assert.equal(project.hq, true);
  assert.equal(project.framerate, DEFAULT_PROJECT.framerate);
});

test("configPayload only stores non-default values", () => {
  assert.deepEqual(configPayload({ ...DEFAULT_PROJECT }), {});
  assert.deepEqual(
    configPayload({ ...DEFAULT_PROJECT, framerate: 60, turbo: true }),
    {
      framerate: 60,
      turbo: true,
    },
  );
});

test("configComment returns null at defaults and ends with the magic string", () => {
  assert.equal(configComment({ ...DEFAULT_PROJECT }), null);
  const comment = configComment({
    ...DEFAULT_PROJECT,
    width: 640,
    interpolation: true,
  });
  assert.ok(comment.endsWith(CONFIG_MAGIC));
  const json = JSON.parse(
    comment.slice(comment.lastIndexOf("\n") + 1, -CONFIG_MAGIC.length),
  );
  assert.deepEqual(json, { interpolation: true, width: 640 });
});

test("findConfigPath walks up from a nested source directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-cfg-"));
  fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Root"\n');
  fs.mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
  assert.equal(
    findConfigPath(path.join(dir, "src", "deep")),
    path.join(dir, "fx.yml"),
  );
  assert.equal(
    loadConfigFrom(path.join(dir, "src", "deep")).project.name,
    "Root",
  );
});

test("loadConfigFrom falls back to defaults when nothing is found", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-empty-"));
  const { project, path: found } = loadConfigFrom(dir);
  assert.equal(found, null);
  assert.equal(project.name, DEFAULT_PROJECT.name);
});
