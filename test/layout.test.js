import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { GRID_OFFSET, MIN_BLOCK_Y, measureScript } from "../src/layout.js";
import { CATALOG } from "../src/catalog.js";
import { loadProject } from "./helpers/vm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build a one-sprite project from source and return its laid-out scripts. */
function layoutOf(source) {
  const { project } = build({
    useConfigFile: false,
    source: `sprite "S" { ${source} }`,
  });
  const sprite = project.targets.find((target) => target.name === "S");
  const scripts = Object.entries(sprite.blocks)
    .filter(([, block]) => block.topLevel)
    .map(([id, block]) => ({ id, ...block }))
    .sort((a, b) => a.y - b.y);
  return { blocks: sprite.blocks, scripts };
}

test("stacks scripts in one vertical column", () => {
  const { blocks, scripts } = layoutOf(`
    when greenFlag { looks.show(); }
    when keyPressed("space") { looks.hide(); }
    when broadcast("go") { looks.say("hi"); }
  `);

  assert.equal(scripts.length, 3);
  for (const block of scripts) assert.equal(block.x, GRID_OFFSET);
  // The column starts half a grid cell in from the canvas corner.
  assert.deepEqual([scripts[0].x, scripts[0].y], [GRID_OFFSET, GRID_OFFSET]);

  // Each script sits one block row below the previous script's bottom.
  for (let i = 1; i < scripts.length; i++) {
    const above = scripts[i - 1];
    const { height } = measureScript(blocks, above.id, CATALOG);
    assert.equal(scripts[i].y, above.y + height + MIN_BLOCK_Y);
  }
});

test("taller scripts push the scripts below them down", () => {
  const short = layoutOf(`
    when greenFlag { looks.show(); }
    when greenFlag { looks.hide(); }
  `).scripts;
  const long = layoutOf(`
    when greenFlag { ${"looks.show(); ".repeat(8)} }
    when greenFlag { looks.hide(); }
  `).scripts;

  const shortGap = short[1].y - short[0].y;
  const longGap = long[1].y - long[0].y;
  assert.ok(
    longGap > shortGap,
    `long script gap ${longGap} should account for its height (short gap ${shortGap})`,
  );
});

function scriptHeight(body) {
  const { blocks, scripts } = layoutOf(`when greenFlag { ${body} }`);
  return measureScript(blocks, scripts[0].id, CATALOG).height;
}

test("value inputs holding reporters do not add statement rows", () => {
  assert.equal(scriptHeight('looks.say("hi");'), 104);
  assert.equal(scriptHeight("looks.say(motion.xPosition());"), 104);
});

test("measures C-blocks with scratch-blocks row metrics", () => {
  assert.equal(
    scriptHeight("if (true) { looks.show(); } else { looks.hide(); }"),
    264,
  );
});

test("positions an if/else with empty branches from fixed row metrics", () => {
  const { scripts } = layoutOf(`
    when greenFlag { if (true) {} else {} }
    when greenFlag { looks.show(); }
  `);
  // Independent of measureScript: hat row plus notch (48 + 8), the if/else
  // row overlapping that notch (48), and the MIN_BLOCK_Y gap (48).
  assert.equal(scripts[1].y - scripts[0].y, 152);
});

test("counts extension blocks as one grid unit taller", () => {
  assert.equal(scriptHeight("looks.show();"), 104);
  assert.equal(scriptHeight("pen.penDown();"), 112);
});

test("does not wrap tall projects into columns", () => {
  const body = "looks.show(); ".repeat(8);
  const { scripts } = layoutOf(
    Array.from({ length: 10 }, () => `when greenFlag { ${body} }`).join("\n"),
  );

  assert.equal(new Set(scripts.map((block) => block.x)).size, 1);
  for (let i = 1; i < scripts.length; i++) {
    assert.ok(scripts[i].y > scripts[i - 1].y, "scripts must go downwards");
  }
});

test("block comments do not change script positions", () => {
  const body = "looks.show(); ".repeat(8);
  const source = (prefix) =>
    Array.from(
      { length: 5 },
      (_, index) =>
        `${prefix && index === 0 ? prefix + "\n" : ""}when greenFlag { ${body} }`,
    ).join("\n");

  const plain = layoutOf(source("")).scripts.map(({ x, y }) => [x, y]);
  const commented = layoutOf(source("// note")).scripts.map(({ x, y }) => [
    x,
    y,
  ]);
  assert.deepEqual(commented, plain);
});

test("scripts do not overlap after the VM loads the built project", async () => {
  const { sb3 } = build({
    file: path.join(root, "test/fixtures/all-blocks/all-blocks.tfx"),
  });
  const vm = await loadProject(sb3);

  for (const target of vm.runtime.targets) {
    const scripts = target.blocks.getScripts();
    if (scripts.length === 0) continue;
    // Measure the blocks the VM deserialized, not the compiler's own tree.
    const blocks = target.blocks._blocks;
    const boxes = scripts.map((id) => {
      const block = target.blocks.getBlock(id);
      const { width, height } = measureScript(blocks, id, CATALOG);
      return {
        id,
        opcode: block.opcode,
        x: block.x,
        y: block.y,
        width,
        height,
      };
    });

    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      assert.equal(typeof a.x, "number", `${a.opcode} has no x`);
      assert.equal(typeof a.y, "number", `${a.opcode} has no y`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        assert.ok(
          !overlaps,
          `${a.opcode} at ${a.x},${a.y} overlaps ${b.opcode} at ${b.x},${b.y}`,
        );
      }
    }
  }
});
