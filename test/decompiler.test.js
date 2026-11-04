import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { CATALOG } from "../src/catalog.js";
import { compile } from "../src/compiler.js";
import { decompile, decompileProject } from "../src/decompiler.js";
import { loadExtensions } from "../src/extensions.js";
import { unzipSync } from "../src/sb3.js";
import { parse } from "../src/parser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "test/fixtures/all-blocks/all-blocks.tfx");

test("decompiles a project back into parseable Triflare Fx", () => {
  const { sb3 } = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  const source = decompile(sb3);
  assert.match(source, /sprite "Player Character" \{/);
  assert.match(source, /when greenFlag \{/);
  assert.match(source, /returning function getHealthStatus\(\)/);
  assert.match(source, /jump\(\);/);
  assert.doesNotThrow(() => parse(source, "roundtrip.tfx"));
});

test("round-trips through compile -> decompile -> compile", () => {
  const first = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  const source = decompile(first.sb3);
  const loadAsset = () =>
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
  const { project } = compile(parse(source, "roundtrip.tfx"), {
    project: {},
    loadAsset,
  });
  assert.deepEqual(
    project.targets.map((t) => t.name),
    ["Stage", "Player Character"],
  );
  assert.ok(project.extensions.includes("pen"));
});

test("reads project JSON directly as well as zipped sb3", () => {
  const { project, sb3 } = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  assert.equal(decompile(project), decompile(sb3));
});

test("accepts an asset prefix when emitting costume references", () => {
  const { project } = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  const source = decompileProject(project, { assetPrefix: "assets/" });
  assert.match(source, /idle: "assets\/[0-9a-f]+\.svg"/);
});

const SIGNALS_EXT = `
(function (Scratch) {
  'use strict';
  Scratch.extensions.register({
    getInfo () {
      return {
        id: 'signals',
        name: 'Signals',
        blocks: [
          {opcode: 'send', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG]',
           arguments: {MSG: {type: Scratch.ArgumentType.STRING}}},
          {opcode: 'level', blockType: Scratch.BlockType.REPORTER, text: 'level'},
          {opcode: 'whenBang', blockType: Scratch.BlockType.HAT, text: 'when bang'}
        ]
      };
    },
    send () {},
    level () { return 1; }
  });
})(Scratch);
`;

test("bundles local extensions as data URIs and decompiles them back", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-ext-decompile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "ext.js"), SIGNALS_EXT);
  const loaded = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.deepEqual(loaded.warnings, []);

  const { sb3 } = build({
    source:
      'sprite "S" { when greenFlag { signals.send("hi"); }\n' +
      "when signals.whenBang { looks.show(); } }",
    useConfigFile: false,
    catalog: loaded.catalog,
    extensionUrls: loaded.extensionUrls,
  });
  const project = JSON.parse(
    unzipSync(sb3).get("project.json").toString("utf8"),
  );
  assert.deepEqual(project.extensions, ["signals"]);
  assert.match(project.extensionURLs.signals, /^data:text\/javascript;base64,/);

  const source = decompile(project, { catalog: loaded.catalog });
  assert.match(source, /signals\.send\("hi"\);/);
  assert.match(source, /when signals\.whenBang\(\) \{/);
  assert.doesNotThrow(() => parse(source, "restored.tfx"));
});

test("every catalog block survives a build -> decompile -> build round trip", () => {
  const first = build({ file: showcase, useConfigFile: false });
  const source = decompile(first.sb3);
  // A gap shows up either as a comment emitted by the decompiler or as a
  // missing opcode after recompiling.
  assert.doesNotMatch(source, /unsupported block/);
  assert.doesNotMatch(source, /\/\* unknown/);

  const loadAsset = () =>
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
  const { project } = compile(parse(source, "roundtrip.tfx"), {
    project: {},
    loadAsset,
  });

  const opcodes = (value) =>
    value.targets
      .flatMap((target) => Object.values(target.blocks).map((b) => b.opcode))
      .sort();
  assert.deepEqual(opcodes(project), opcodes(first.project));

  // Name the coverage explicitly so a future entry without a decompiler path
  // fails here instead of quietly becoming a comment.
  const emitted = new Set(opcodes(project));
  for (const [name, entry] of Object.entries(CATALOG)) {
    assert.ok(emitted.has(entry.opcode), `${name} -> ${entry.opcode}`);
  }
});

test("the sb3 zip contains project.json plus the referenced assets", () => {
  const { sb3, assets } = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  const files = unzipSync(sb3);
  assert.ok(files.has("project.json"));
  for (const name of assets.keys())
    assert.ok(files.has(name), `missing asset ${name}`);
});
