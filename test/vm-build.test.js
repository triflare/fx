import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-vm-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  write("package.json", '{"type":"module"}');
  return { root, write };
}

test("VM marker tracks build inputs while retaining commit and version checks", (t) => {
  const { root, write } = fixture(t);
  const script = write(
    "scripts/build-vm.js",
    fs.readFileSync(new URL("../scripts/build-vm.js", import.meta.url)),
  );
  const entry = write("scripts/vm-entry.cjs", "module.exports = {};\n");
  write("vendor/pm-vm/package.json", '{"name":"vm","version":"1.0.0"}');
  write("vendor/pm-vm/LICENSE", "fixture license");
  // Exercise the real build script without installing or compiling the VM.
  write(
    "vendor/pm-vm/node_modules/webpack/index.js",
    `const fs = require('node:fs');
     const path = require('node:path');
     module.exports = (config, callback) => {
       fs.mkdirSync(config.output.path, {recursive: true});
       fs.writeFileSync(path.join(config.output.path, 'scratch-vm.js'), 'module.exports = {};');
       callback(null, {hasErrors: () => false, toString: () => 'fixture build'});
     };`,
  );
  write("vendor/pm-vm/node_modules/@babel/preset-env/index.js", "");
  const npm = write("tools/npm", "#!/bin/sh\nexit 0\n");
  fs.chmodSync(npm, 0o755);
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const markerFile = path.join(root, "vendor/pm-vm-dist/.fx-build.json");
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.dirname(npm)}${path.delimiter}${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const marker = () => JSON.parse(fs.readFileSync(markerFile, "utf8"));
  assert.match(run(), /copied vm/);
  const originalHash = marker().inputHash;
  assert.match(originalHash, /^[a-f0-9]{64}$/);
  assert.match(run(), /is up to date/);
  for (const [file, before, after] of [
    [entry, "{}", "{ changed: true }"],
    [script, '"decode-html",', '"decode-html", "extra-external",'],
    [script, "webpack@4.47.0", "webpack@4.46.0"],
    [script, 'mode: "production"', 'mode: "development"'],
    [
      script,
      "// Hash source bytes",
      "// Changed build logic\n  // Hash source bytes",
    ],
  ]) {
    const previousHash = marker().inputHash;
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace(before, after),
    );
    assert.match(run(), /copied vm/);
    assert.notEqual(marker().inputHash, previousHash);
    assert.match(run(), /is up to date/);
  }
  for (const patch of [
    { inputHash: undefined },
    { commit: "old" },
    { version: "old" },
  ]) {
    fs.writeFileSync(markerFile, JSON.stringify({ ...marker(), ...patch }));
    assert.match(run(), /copied vm/);
  }
  assert.match(run("--force"), /copied vm/);
});

test("VM loader distinguishes absent bundles from bundle load failures", async (t) => {
  const { write } = fixture(t);
  const adapter = write(
    "src/vm.js",
    fs.readFileSync(new URL("../src/vm.js", import.meta.url)),
  );
  const { loadVmModules } = await import(pathToFileURL(adapter));
  assert.throws(loadVmModules, /VM build, which is missing/);
  write("vendor/pm-vm-dist/package.json", '{"type":"commonjs"}');
  const bundle = write(
    "vendor/pm-vm-dist/dist/scratch-vm.js",
    "require('fx-missing-fixture-dependency');",
  );
  assert.throws(
    loadVmModules,
    (error) =>
      error.code === "MODULE_NOT_FOUND" &&
      error.message.includes("fx-missing-fixture-dependency"),
  );
  fs.writeFileSync(bundle, "throw new TypeError('fixture load failure');");
  assert.throws(loadVmModules, {
    name: "TypeError",
    message: "fixture load failure",
  });
  fs.writeFileSync(
    bundle,
    "module.exports = {VirtualMachine: class {}, centralDispatch: {}, extensionApi: {}};",
  );
  const api = loadVmModules();
  assert.equal(typeof api.VirtualMachine, "function");
  assert.equal(loadVmModules(), api);
});
