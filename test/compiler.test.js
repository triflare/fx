import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { CompileError } from "../src/errors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function opcodes(project) {
  return project.targets.flatMap((t) =>
    Object.values(t.blocks).map((b) => b.opcode),
  );
}

test("compiles the spec fixture with pen extension and assets", () => {
  const result = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  assert.deepEqual(
    result.project.targets.map((t) => t.name),
    ["Stage", "Player Character"],
  );
  assert.ok(result.project.extensions.includes("pen"));
  assert.equal(result.assets.size, 3);
  const codes = opcodes(result.project);
  assert.ok(codes.includes("motion_gotoxy"));
  assert.ok(codes.includes("procedures_definition"));
  assert.ok(codes.includes("procedures_call"));
  assert.ok(codes.includes("procedures_return"));
  assert.ok(codes.includes("pen_stamp"));
});

test("compiles a standalone source string with variables and list operations", () => {
  const ast = parse(
    `
        sprite "Bot" {
            let score = 0;
            list items = ["a"];
            when greenFlag {
                score += 1;
                items.push("b");
                items.deleteAll();
                looks.say(items.itemAt(1));
            }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: { width: 480, height: 360 } });
  const codes = opcodes(project);
  assert.ok(codes.includes("data_changevariableby"));
  assert.ok(codes.includes("data_addtolist"));
  assert.ok(codes.includes("data_deletealloflist"));
  assert.ok(codes.includes("data_itemoflist"));
});

test("marks returning procedures with a return mutation", () => {
  const ast = parse(
    `
        sprite "Bot" {
            returning function level() { return 3; }
            when greenFlag { looks.say(level()); }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const call = Object.values(sprite.blocks).find(
    (b) => b.opcode === "procedures_call",
  );
  assert.equal(call.mutation.returns, "true");
  const def = Object.values(sprite.blocks).find(
    (b) => b.opcode === "procedures_definition_return",
  );
  const proto = sprite.blocks[def.inputs.custom_block[1]];
  assert.equal(proto.mutation.proccode, "level");
  assert.equal(proto.mutation.returns, "true");
  const ret = Object.values(sprite.blocks).find(
    (b) => b.opcode === "procedures_return",
  );
  assert.ok(ret.inputs.return, "procedures_return uses the `return` input");
});

test("keeps IDs unique when counter and random digits would overlap", async (t) => {
  const { Compiler } = await import("../src/compiler.js?uid-regression");
  let call = 0;
  t.mock.method(Math, "random", () => {
    call += 1;
    return ((call === 1 ? 0x23 : 0x3) + 0.5) / 0xffffff;
  });
  const compiler = new Compiler();
  const ids = Array.from({ length: 0x12 }, (_, i) =>
    compiler.broadcast(`event${i}`),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("bc")));
});

test("keeps different prefixes distinct from hexadecimal counter digits", async (t) => {
  const { Compiler } = await import("../src/compiler.js?uid-prefix-regression");
  t.mock.method(Math, "random", () => 0);
  const compiler = new Compiler();
  const broadcastId = compiler.broadcast("event");
  const ctx = { target: { blocks: {} } };
  for (let i = 1; i < 0xc1; i += 1) {
    compiler.addBlock(ctx, { opcode: "looks_show" });
  }
  assert.ok(!Object.hasOwn(ctx.target.blocks, broadcastId));
  assert.equal(Object.keys(ctx.target.blocks).length, 0xc0);
});

test("uses boolean procedure slots consistently in prototypes and calls", () => {
  for (const modifiers of ["returning warp", "warp returning"]) {
    const { project } = compile(
      parse(`
      sprite "S" {
        ${modifiers} function choose(flag: boolean, text: string, count: number) {
          if (flag) { return text; }
          return count;
        }
        when greenFlag { looks.say(choose(1 > 0, "yes", 2)); }
      }
    `),
    );
    const sprite = project.targets.find((target) => !target.isStage);
    const blocks = Object.values(sprite.blocks);
    const prototype = blocks.find(
      (block) => block.opcode === "procedures_prototype",
    );
    const call = blocks.find((block) => block.opcode === "procedures_call");
    assert.equal(prototype.mutation.proccode, "choose %b %s %s");
    assert.equal(call.mutation.proccode, prototype.mutation.proccode);
    assert.equal(prototype.mutation.warp, "true");
    assert.equal(prototype.mutation.returns, "true");
    const argId = JSON.parse(prototype.mutation.argumentids)[0];
    assert.equal(
      sprite.blocks[prototype.inputs[argId][1]].opcode,
      "argument_reporter_boolean",
    );
    assert.equal(sprite.blocks[call.inputs[argId][1]].opcode, "operator_gt");
  }
});

test("normalizes hex colors and emits a stop mutation", () => {
  const ast = parse(
    `
        sprite "Bot" {
            when greenFlag {
                pen.setColor("#abc");
                control.stop("other scripts in sprite");
            }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const pen = Object.values(sprite.blocks).find(
    (b) => b.opcode === "pen_setPenColorToColor",
  );
  assert.deepEqual(pen.inputs.COLOR[1], [9, "#aabbcc"]);
  const stop = Object.values(sprite.blocks).find(
    (b) => b.opcode === "control_stop",
  );
  assert.equal(stop.mutation.hasnext, true);
});

test("marks forever loops with PenguinMod's loop nub mutation", () => {
  const ast = parse(
    `
        sprite "Bot" {
            when greenFlag {
                control.forever { looks.show(); }
                looks.hide();
                control.forever { looks.show(); }
            }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const loops = Object.values(sprite.blocks).filter(
    (b) => b.opcode === "control_forever",
  );
  assert.equal(loops.length, 2);
  // Blocks stacked below a forever loop only load in the editor when the loop's
  // mutation says it has a next-statement nub.
  const stacked = loops.find((b) => b.next);
  assert.deepEqual(stacked.mutation, {
    tagName: "mutation",
    hasbreak: true,
    children: [],
  });
  const terminal = loops.find((b) => !b.next);
  assert.equal(terminal.mutation.hasbreak, false);
});

test("orders dropdowns before value inputs for mixed blocks", () => {
  const ast = parse(
    `
        sprite "S" {
            when greenFlag {
                looks.setEffect("ghost", 25);
                looks.say(operators.math("sqrt", 9));
            }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const setEffect = Object.values(sprite.blocks).find(
    (b) => b.opcode === "looks_seteffectto",
  );
  assert.deepEqual(setEffect.fields.EFFECT, ["ghost"]);
  assert.deepEqual(setEffect.inputs.VALUE[1], [4, "25"]);
  const math = Object.values(sprite.blocks).find(
    (b) => b.opcode === "operator_mathop",
  );
  assert.deepEqual(math.fields.OPERATOR, ["sqrt"]);
  assert.deepEqual(math.inputs.NUM[1], [4, "9"]);
});

test("stores project settings in a stage _twconfig_ comment", () => {
  const result = build({
    source: 'sprite "S" { when greenFlag { looks.show(); } }',
    dir: root,
    projectConfig: {
      name: "x",
      framerate: 60,
      width: 480,
      height: 360,
      turbo: false,
      interpolation: true,
      hq: false,
      runtime: {},
      extensions: [],
    },
  });
  const stage = result.project.targets.find((t) => t.isStage);
  const comments = Object.values(stage.comments);
  assert.equal(comments.length, 1);
  assert.match(comments[0].text, /\/\/ _twconfig_$/);
  const json = JSON.parse(
    comments[0].text.slice(
      comments[0].text.lastIndexOf("\n") + 1,
      -" // _twconfig_".length,
    ),
  );
  assert.deepEqual(json, { framerate: 60, interpolation: true });
});

test("rejects statements outside a hat", () => {
  const ast = parse('sprite "S" { looks.show(); }', "inline.tfx");
  assert.throws(
    () => compile(ast, { project: {} }),
    (err) => {
      assert.ok(err instanceof CompileError);
      assert.match(err.message, /inside a `when/);
      return true;
    },
  );
});

test("rejects unknown blocks", () => {
  const ast = parse(
    'sprite "S" { when greenFlag { motion.teleport(1); } }',
    "inline.tfx",
  );
  assert.throws(() => compile(ast, { project: {} }), /Unknown block/);
});

test("emits the pen extension only when pen blocks are used", () => {
  const withPen = build({
    file: path.join(root, "test/fixtures/player/player.tfx"),
  });
  assert.deepEqual(withPen.project.extensions, ["pen"]);

  const withoutPen = compile(
    parse('sprite "S" { when greenFlag { looks.show(); } }', "inline.tfx"),
    { project: {} },
  );
  assert.deepEqual(withoutPen.project.extensions, []);
});

test("compiles catalog boolean inputs, including infix and/or", () => {
  const ast = parse(
    `
        sprite "S" {
            when greenFlag {
                if (true and false) { looks.show(); }
                if (true or false) { looks.hide(); }
                if (operators.and(true, false)) { looks.show(); }
                if (operators.or(false, true)) { looks.hide(); }
                if (operators.not(false)) { looks.show(); }
                control.if(true) { looks.show(); }
                control.ifElse(false) { looks.show(); } else { looks.hide(); }
                control.waitUntil(false);
                control.repeatUntil(false) { looks.show(); }
            }
        }
    `,
    "inline.tfx",
  );
  const { project } = compile(ast, { project: {} });
  const codes = opcodes(project);
  for (const opcode of [
    "operator_and",
    "operator_or",
    "operator_not",
    "control_if",
    "control_if_else",
    "control_wait_until",
    "control_repeat_until",
  ]) {
    assert.ok(codes.includes(opcode), `expected ${opcode}`);
  }
});

test("emits the project shape scratch-vm's sb3 loader expects", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(40, 16);
  png.writeUInt32BE(30, 20);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>',
  );
  const ast = parse(
    `sprite "S" { costumes: { dot: "dot.png", art: "art.svg" }; when greenFlag { looks.show(); } }`,
    "inline.tfx",
  );
  const { project } = compile(ast, {
    project: {},
    loadAsset: (file) => (file.endsWith(".png") ? png : svg),
  });

  // VM.sb3 serializer metadata: `semver`, `vm`, `agent`.
  assert.equal(project.meta.semver, "3.0.0");
  assert.equal(project.meta.vm, "0.2.0");
  assert.equal(typeof project.meta.agent, "string");

  const stage = project.targets.find((target) => target.isStage);
  assert.equal(stage.layerOrder, 0);
  for (const key of [
    "tempo",
    "videoTransparency",
    "videoState",
    "textToSpeechLanguage",
  ]) {
    assert.ok(key in stage, `stage.${key}`);
  }

  const sprite = project.targets.find((target) => target.name === "S");
  // Bitmap costumes are 2x in Scratch 3 (`import/load-costume.js`); SVG is 1.
  const [dot, art] = sprite.costumes;
  assert.equal(dot.dataFormat, "png");
  assert.equal(dot.bitmapResolution, 2);
  assert.deepEqual([dot.rotationCenterX, dot.rotationCenterY], [20, 15]);
  assert.equal(art.dataFormat, "svg");
  assert.equal(art.bitmapResolution, 1);
  // Values from RenderedTarget's ROTATION_STYLE_* constants.
  assert.ok(
    ["all around", "left-right", "don't rotate"].includes(sprite.rotationStyle),
  );
  assert.equal(typeof sprite.visible, "boolean");
  assert.equal(typeof sprite.draggable, "boolean");
  for (const key of ["size", "direction", "x", "y"])
    assert.equal(typeof sprite[key], "number", key);

  for (const block of Object.values(sprite.blocks)) {
    assert.equal(typeof block.opcode, "string");
    assert.equal(typeof block.shadow, "boolean");
    assert.equal(typeof block.topLevel, "boolean");
    if (block.topLevel) assert.equal(typeof block.x, "number");
  }
});

test("warns about asset formats Scratch 3 cannot load", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-assets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "dot.gif"), Buffer.alloc(4));
  fs.writeFileSync(path.join(dir, "hum.ogg"), Buffer.alloc(4));
  const result = build({
    dir,
    useConfigFile: false,
    source:
      'sprite "S" { costumes: { dot: "dot.gif" }; sounds: { hum: "hum.ogg" }; ' +
      "when greenFlag { looks.show(); } }",
  });
  assert.deepEqual(result.warnings, [
    'costume "dot" uses dataFormat "gif"; Scratch 3 costumes are svg, png or jpg',
    'sound "hum" uses dataFormat "ogg"; Scratch 3 sounds are wav or mp3',
  ]);
});

test("does not warn about svg, png, jpg, wav or mp3 assets", () => {
  const result = build({
    file: path.join(root, "test/fixtures/all-blocks/all-blocks.tfx"),
    useConfigFile: false,
  });
  assert.deepEqual(result.warnings, []);
});

test("uses extension argument defaults when a call omits an argument", () => {
  const ast = parse(
    `sprite "S" { when greenFlag { demo.go(); } }`,
    "inline.tfx",
  );
  const catalog = {
    "demo.go": {
      opcode: "demo_go",
      kind: "command",
      extension: "demo",
      inputs: {
        N: { type: "number", default: 60 },
        T: { type: "string", default: "hi" },
        X: { type: "number" },
      },
    },
  };
  const { project } = compile(ast, { project: {}, catalog });
  const target = project.targets.find((t) => t.name === "S");
  const block = Object.values(target.blocks).find(
    (b) => b.opcode === "demo_go",
  );
  assert.deepEqual(block.inputs.N, [1, [4, "60"]]);
  assert.deepEqual(block.inputs.T, [1, [10, "hi"]]);
  assert.deepEqual(block.inputs.X, [1, [4, "0"]]);
});

test("rejects statements after a block that ends the script", () => {
  const cases = [
    [
      'sprite "S" { returning function f() { return 1; looks.say("x"); } when greenFlag { looks.show(); } }',
      /follow `return`/,
    ],
    [
      'sprite "S" { when greenFlag { control.stop("all"); looks.show(); } }',
      /follow `control\.stop\("all"\)`/,
    ],
    [
      'sprite "S" { when greenFlag { control.stop("this script"); looks.show(); } }',
      /follow `control\.stop\("this script"\)`/,
    ],
    [
      'sprite "S" { when cloneStart { control.deleteThisClone(); looks.show(); } }',
      /follow `control\.deleteThisClone\(\)`/,
    ],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(
      () => compile(parse(source, "inline.tfx"), { project: {} }),
      pattern,
      source,
    );
  }
});

test("allows blocks after a non-terminal stop and a terminal block last", () => {
  const ast = parse(
    `
        sprite "S" {
            returning function f() { return 1; }
            when greenFlag {
                control.stop("other scripts in sprite");
                looks.show();
            }
            when cloneStart { control.deleteThisClone(); }
        }
    `,
    "inline.tfx",
  );
  assert.doesNotThrow(() => compile(ast, { project: {} }));
});
