import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  loadExtensions,
  makeSandbox,
  readExtensionDataUri,
  BlockType,
  ArgumentType,
  BlockShape,
  NotchShape,
} from "../src/extensions.js";

const require = createRequire(import.meta.url);

function tempExtension(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-ext-"));
  fs.writeFileSync(path.join(dir, "ext.js"), source);
  return dir;
}

const SIGNALS = `
(function (Scratch) {
  'use strict';
  class Signals {
    getInfo () {
      return {
        id: 'signals',
        name: 'Signals',
        blocks: [
          {opcode: 'send', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG]',
           arguments: {MSG: {type: Scratch.ArgumentType.STRING, defaultValue: 'hi'}}},
          {opcode: 'level', blockType: Scratch.BlockType.REPORTER, text: 'level'},
          {opcode: 'isOn', blockType: Scratch.BlockType.BOOLEAN, text: 'is on?'},
          {opcode: 'loop', blockType: Scratch.BlockType.LOOP, text: 'loop', branchCount: 2},
          {opcode: 'whenBang', blockType: Scratch.BlockType.HAT, text: 'when bang [WHO]',
           arguments: {WHO: {type: Scratch.ArgumentType.STRING, defaultValue: 'all'}}}
        ]
      };
    }
    send () {}
    level () { return 1; }
    isOn () { return true; }
  }
  Scratch.extensions.register(new Signals());
})(Scratch);
`;

test("synthesizes catalog entries with the right kinds and opcodes", async () => {
  const dir = tempExtension(SIGNALS);
  const { catalog, extensionUrls, warnings } = await loadExtensions(
    ["./ext.js"],
    { baseDir: dir },
  );
  assert.deepEqual(warnings, []);
  assert.match(extensionUrls.signals, /^data:text\/javascript;base64,/);
  assert.equal(readExtensionDataUri(extensionUrls.signals), SIGNALS);

  assert.equal(catalog["signals.send"].opcode, "signals_send");
  assert.equal(catalog["signals.send"].kind, "command");
  assert.deepEqual(catalog["signals.send"].inputs.MSG, {
    type: "string",
    default: "hi",
  });
  assert.equal(catalog["signals.send"].extension, "signals");
  assert.equal(catalog["signals.level"].kind, "reporter");
  assert.equal(catalog["signals.isOn"].kind, "boolean");
  assert.equal(catalog["signals.whenBang"].kind, "hat");
  assert.deepEqual(catalog["signals.whenBang"].args, [
    { input: "WHO", type: "string", default: "all" },
  ]);
});

test("gives loops and conditionals substacks based on branchCount", async () => {
  const dir = tempExtension(SIGNALS);
  const { catalog } = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.deepEqual(catalog["signals.loop"].inputs.SUBSTACK, {
    type: "substack",
  });
  assert.deepEqual(catalog["signals.loop"].inputs.SUBSTACK2, {
    type: "substack",
  });
});

test("fetches remote extensions and records their URL", async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => SIGNALS,
    };
  };
  const { catalog, extensionUrls } = await loadExtensions(
    ["https://example.test/signals.js"],
    { fetchImpl },
  );
  assert.deepEqual(fetched, ["https://example.test/signals.js"]);
  assert.equal(extensionUrls.signals, "https://example.test/signals.js");
  assert.ok(catalog["signals.send"]);
});

test("warns instead of throwing for broken extensions", async () => {
  const dir = tempExtension("this is not valid javascript {{{");
  const { catalog, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(catalog, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /failed to load extension/);
});

test("warns when an extension never registers", async () => {
  const dir = tempExtension("const unused = 1;");
  const { warnings } = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.ok(
    warnings.some((w) => /did not call Scratch.extensions.register/.test(w)),
  );
});

test("runs extensions in a sandbox without process or require", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (typeof process !== 'undefined') throw new Error('process leaked');
            if (typeof require !== 'undefined') throw new Error('require leaked');
            if (typeof module !== 'undefined') throw new Error('module leaked');
            Scratch.extensions.register({getInfo () { return {id: 'safe', blocks: []}; }});
        })(Scratch);
    `);
  const { warnings, ids } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
  assert.deepEqual(ids, ["safe"]);
});

test("shim constructors cannot reach Node APIs or mutate host objects", async (t) => {
  const dir = tempExtension(`
    const constructors = [
      Scratch.extensions.register.constructor,
      Scratch.Cast.toString.constructor,
      Scratch.Color.decimalToHex.constructor,
      Scratch.Clone.simple.constructor,
      console.log.constructor, setTimeout.constructor,
      Math.max.constructor, URL.constructor,
      Uint8Array.constructor, Object.constructor
    ];
    for (const Constructor of constructors) {
      const hostProcess = Constructor('return typeof process === "undefined" ? null : process')();
      if (typeof hostProcess?.pid === 'number') {
        throw new Error('Node APIs leaked');
      }
    }
    Object.prototype.fxExtensionPollution = true;
    Scratch.extensions.register({getInfo() { return {id: 'isolated', blocks: []}; }});
  `);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { ids, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["isolated"], warnings.join("\n"));
  assert.equal(Object.prototype.fxExtensionPollution, undefined);
});

test("bounds source execution and getInfo execution in the CLI", (t) => {
  const bin = fileURLToPath(new URL("../bin/fx.js", import.meta.url));
  for (const source of [
    "while (true) {}",
    "Scratch.extensions.register({getInfo() { while (true) {} }});",
    "Scratch.extensions.register({getInfo() { return {toJSON() { while (true) {} }}; }});",
  ]) {
    const dir = tempExtension(source);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(
      path.join(dir, "fx.yml"),
      'project:\n  extensions: ["./ext.js"]\n',
    );
    const result = spawnSync(process.execPath, [bin, "catalog", dir], {
      encoding: "utf8",
      timeout: 12000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /extension execution timed out/);
  }
});

const UNSANDBOXED = `
(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('"Demo" must run unsandboxed');
  }
  Scratch.extensions.register({
    getInfo () {
      return {
        id: 'demo',
        name: 'Demo',
        blocks: [{opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}]
      };
    },
    go () {}
  });
})(Scratch);
`;

test("loads extensions that only work unsandboxed and flags them", async () => {
  const dir = tempExtension(UNSANDBOXED);
  const { catalog, ids, unsandboxed, warnings } = await loadExtensions(
    ["./ext.js"],
    { baseDir: dir },
  );
  assert.deepEqual(ids, ["demo"]);
  assert.deepEqual(unsandboxed, ["demo"]);
  assert.equal(catalog["demo.go"].opcode, "demo_go");
  assert.ok(
    warnings.some((w) => /requires unsandboxed mode/.test(w)),
    warnings.join("\n"),
  );
});

test("silences the unsandboxed warning for declared extensions", async () => {
  const dir = tempExtension(UNSANDBOXED);
  const { unsandboxed, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["demo"],
  });
  assert.deepEqual(unsandboxed, ["demo"]);
  assert.deepEqual(
    warnings.filter((w) => /unsandboxed/.test(w)),
    [],
  );
});

test("flags a declared extension that actually loads sandboxed", async () => {
  const dir = tempExtension(SIGNALS);
  const { warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["signals"],
  });
  assert.ok(
    warnings.some((w) => /loads in the sandbox/.test(w)),
    warnings.join("\n"),
  );
});

test("flags a declared entry that matches no loaded extension", async () => {
  const dir = tempExtension(SIGNALS);
  const { warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["nope"],
  });
  assert.ok(
    warnings.some((w) => /does not match any loaded extension/.test(w)),
    warnings.join("\n"),
  );
});

test("treats an alert-and-return guard as requiring unsandboxed", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (!Scratch.extensions.unsandboxed) {
                alert('Nope must run unsandboxed!');
                return;
            }
            Scratch.extensions.register({getInfo () { return {id: 'nope', blocks: [
                {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}
            ]}; }});
        })(Scratch);
    `);
  const { catalog, ids, unsandboxed } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["nope"]);
  assert.deepEqual(unsandboxed, ["nope"]);
  assert.equal(catalog["nope.go"].opcode, "nope_go");
});

test("tolerates module-scope VM and browser access", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            const runtime = Scratch.vm.runtime;
            runtime.on('PROJECT_START', () => {});
            runtime.registerSerializer('x', v => v, v => v);
            const canvas = document.createElement('canvas');
            canvas.width = navigator.language.length;
            new Audio('data:audio/mp3;base64,');
            Scratch.extensions.register({getInfo () { return {id: 'vmish', blocks: [
                {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}
            ]}; }});
        })(Scratch);
    `);
  const { catalog, warnings, ids } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["vmish"]);
  assert.equal(catalog["vmish.go"].opcode, "vmish_go");
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
});

test("exposes PenguinMod detection to extension code", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (Scratch.extensions.isPenguinMod !== true) throw new Error('not penguinmod');
            Scratch.extensions.register({getInfo () { return {id: 'pm', blocks: []}; }});
        })(Scratch);
    `);
  const { ids, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["pm"]);
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
});

test("supports Scratch.translate.setup from generated l10n bundles", async (t) => {
  const dir = tempExtension(`
        Scratch.translate.setup({fr: {'Hello': 'Bonjour'}});
        (function (Scratch) {
            Scratch.extensions.register({
                getInfo () {
                    return {id: 'l10n', blocks: [
                        {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: Scratch.translate('Hello')}
                    ]};
                }
            });
        })(Scratch);
    `);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { catalog, ids, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
    warnings.join("\n"),
  );
  assert.deepEqual(ids, ["l10n"]);
  assert.equal(catalog["l10n.go"].opcode, "l10n_go");
});

test("carries extension argument defaults into the catalog", async (t) => {
  const dir = tempExtension(`
        (function (Scratch) {
            Scratch.extensions.register({
                getInfo () {
                    return {id: 'defaults', blocks: [
                        {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go [N] [T] [A]', arguments: {
                            N: {type: Scratch.ArgumentType.NOTE, defaultValue: 60},
                            T: {type: Scratch.ArgumentType.STRING, defaultValue: 'hi'},
                            A: {type: Scratch.ArgumentType.BOOLEAN}
                        }},
                        {opcode: 'receive', blockType: Scratch.BlockType.HAT, text: 'receive [WHO]', arguments: {
                            WHO: {type: Scratch.ArgumentType.STRING, defaultValue: 'all'}
                        }}
                    ]};
                }
            });
        })(Scratch);
    `);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { catalog } = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.deepEqual(catalog["defaults.go"].inputs.N, {
    type: "number",
    default: 60,
  });
  assert.deepEqual(catalog["defaults.go"].inputs.T, {
    type: "string",
    default: "hi",
  });
  assert.deepEqual(catalog["defaults.go"].inputs.A, { type: "boolean" });
  assert.deepEqual(catalog["defaults.receive"].args, [
    { input: "WHO", type: "string", default: "all" },
  ]);
});

test("shim API matches the scratch-vm extension API", async () => {
  const vmApi = require("scratch-vm/src/extension-support/tw-extension-api-common");
  const vmCast = require("scratch-vm/src/util/cast");
  const vmColor = require("scratch-vm/src/util/color");
  const { Scratch: shim } = makeSandbox([]);

  for (const name of [
    "ArgumentAlignment",
    "ArgumentType",
    "BlockShape",
    "BlockType",
    "NotchShape",
    "TargetType",
  ]) {
    assert.deepEqual(shim[name], vmApi[name], `Scratch.${name}`);
  }
  for (const name of Object.keys(vmApi)) {
    assert.ok(name in shim, `Scratch.${name} missing from the sandbox`);
  }

  const members = (value) =>
    Object.getOwnPropertyNames(value)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .sort();
  assert.deepEqual(members(shim.Cast), members(vmCast), "Scratch.Cast");
  assert.deepEqual(members(shim.Color), members(vmColor), "Scratch.Color");

  const samples = [
    true,
    false,
    0,
    1,
    -0,
    5.5,
    NaN,
    Infinity,
    "",
    " ",
    "0",
    "1",
    "false",
    "FALSE",
    "true",
    "abc",
    " 12 ",
    null,
    undefined,
    [1],
    {},
  ];
  for (const value of samples) {
    const label = `Cast on ${JSON.stringify(value) ?? String(value)}`;
    assert.equal(shim.Cast.toBoolean(value), vmCast.toBoolean(value), label);
    assert.equal(shim.Cast.toNumber(value), vmCast.toNumber(value), label);
    assert.equal(
      shim.Cast.isWhiteSpace(value),
      vmCast.isWhiteSpace(value),
      label,
    );
    assert.equal(shim.Cast.isInt(value), vmCast.isInt(value), label);
    assert.deepEqual(
      shim.Cast.toRgbColorObject(value),
      vmCast.toRgbColorObject(value),
      label,
    );
    assert.deepEqual(
      shim.Cast.toRgbColorList(value),
      vmCast.toRgbColorList(value),
      label,
    );
  }

  for (const [a, b] of [
    ["a", "B"],
    [2, 10],
    ["2", "10"],
    [null, 0],
    ["0", ""],
    [true, "TRUE"],
    [Infinity, Infinity],
  ]) {
    const label = `Cast.compare(${String(a)}, ${String(b)})`;
    assert.equal(
      Math.sign(shim.Cast.compare(a, b)),
      Math.sign(vmCast.compare(a, b)),
      label,
    );
  }

  for (const [index, length, acceptAll] of [
    [1, 3, false],
    ["last", 3, false],
    ["last", 0, false],
    ["all", 3, true],
    ["all", 3, false],
    ["random", 0, false],
    [9, 3, false],
    ["2", 3, false],
  ]) {
    assert.equal(
      shim.Cast.toListIndex(index, length, acceptAll),
      vmCast.toListIndex(index, length, acceptAll),
      `Cast.toListIndex(${String(index)})`,
    );
  }

  assert.equal(shim.Color.RGB_BLACK.r, vmColor.RGB_BLACK.r);
  assert.equal(shim.Color.RGB_WHITE.b, vmColor.RGB_WHITE.b);
  for (const decimal of [0, 0x336699, -1, 0xffffff]) {
    assert.equal(
      shim.Color.decimalToHex(decimal),
      vmColor.decimalToHex(decimal),
    );
    assert.deepEqual(
      shim.Color.decimalToRgb(decimal),
      vmColor.decimalToRgb(decimal),
    );
  }
  for (const hex of ["#336699", "336699", "#f00", "nope"]) {
    assert.deepEqual(shim.Color.hexToRgb(hex), vmColor.hexToRgb(hex));
  }
  for (const rgb of [
    { r: 0, g: 0, b: 0 },
    { r: 51, g: 102, b: 153 },
  ]) {
    assert.equal(shim.Color.rgbToHex(rgb), vmColor.rgbToHex(rgb));
    assert.equal(shim.Color.rgbToDecimal(rgb), vmColor.rgbToDecimal(rgb));
    assert.deepEqual(shim.Color.rgbToHsv(rgb), vmColor.rgbToHsv(rgb));
  }
  for (const hsv of [
    { h: 0, s: 0, v: 0 },
    { h: 210, s: 0.5, v: 0.6 },
  ]) {
    assert.deepEqual(shim.Color.hsvToRgb(hsv), vmColor.hsvToRgb(hsv));
  }
  assert.deepEqual(
    shim.Color.mixRgb({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5),
    vmColor.mixRgb({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5),
  );

  assert.equal(typeof shim.translate, "function");
  assert.equal(typeof shim.translate.setup, "function");
  assert.equal(shim.translate.language, "en");
  assert.equal(shim.translate("Hello"), "Hello");
  assert.equal(shim.translate({ default: "Hi" }), "Hi");
  assert.throws(() => shim.translate(1), /unsupported data type/);
  shim.translate.setup({ fr: { Hello: "Bonjour" } });

  for (const name of [
    "importModule",
    "fetch",
    "dataURL",
    "blob",
    "evalAndReturn",
  ]) {
    assert.equal(typeof shim.external[name], "function", `external.${name}`);
    await assert.rejects(shim.external[name]("https://example.test/x.js"));
  }
});

test("warns on HTTP errors for remote extensions", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: async () => "",
  });
  const { warnings } = await loadExtensions(
    ["https://example.test/missing.js"],
    { fetchImpl },
  );
  assert.match(warnings[0], /HTTP 404/);
});

test("exposes the PenguinMod enum shims to extension code", () => {
  assert.equal(BlockType.COMMAND, "command");
  assert.equal(ArgumentType.STRING, "string");
  assert.equal(BlockShape.SQUARE, 3);
  assert.equal(NotchShape.ARROW, "arrow");
});
