import { test } from "node:test";
import assert from "node:assert/strict";
import { build, writeSb3 } from "../src/build.js";
import { GRID_OFFSET, MIN_BLOCK_Y } from "../src/layout.js";
import { loadProject } from "./helpers/vm.js";

function compile(source) {
  return build({ useConfigFile: false, source }).project;
}

function sprite(project, name = "S") {
  return project.targets.find((target) => target.name === name);
}

function blockByOpcode(target, opcode) {
  const entry = Object.entries(target.blocks).find(
    ([, block]) => block.opcode === opcode,
  );
  assert.ok(entry, `expected a ${opcode} block`);
  return entry;
}

function commentsFor(target, blockId) {
  return Object.values(target.comments).filter(
    (comment) => comment.blockId === blockId,
  );
}

test("attaches leading, trailing, and block comments to their blocks", () => {
  const project = compile(`
    sprite "S" {
      // hat docs
      when greenFlag {
        // greeting
        looks.say("hi"); // trailing
        /* multi
         * line */
        looks.hide();
      }
    }
  `);
  const target = sprite(project);

  const [hatId] = blockByOpcode(target, "event_whenflagclicked");
  assert.equal(commentsFor(target, hatId)[0].text, "hat docs");

  const [sayId] = blockByOpcode(target, "looks_say");
  const sayComments = commentsFor(target, sayId);
  assert.equal(sayComments.length, 1, "comments on one block are merged");
  assert.equal(sayComments[0].text, "greeting\ntrailing");
  const sayCommentId = target.blocks[sayId].comment;
  assert.ok(sayCommentId, "block.comment links the comment");
  assert.equal(target.comments[sayCommentId].text, "greeting\ntrailing");

  const [hideId] = blockByOpcode(target, "looks_hide");
  assert.equal(commentsFor(target, hideId)[0].text, "multi\nline");
});

test("attaches comments in empty bodies to the enclosing block", () => {
  const project = compile(`
    sprite "S" {
      when greenFlag {
        forever {
          // spin
        }
      }
    }
  `);
  const target = sprite(project);
  const [foreverId] = blockByOpcode(target, "control_forever");
  assert.equal(commentsFor(target, foreverId)[0].text, "spin");
});

test("keeps unanchorable comments as workspace comments on their target", () => {
  const project = compile(`
    // sprite docs
    sprite "S" {
      let score = 0; // score docs
      when greenFlag { looks.show(); }
    }
    stage {
      // stage docs
      let shared = 0;
    }
  `);

  const s = sprite(project);
  const workspace = Object.values(s.comments).filter((c) => c.blockId === null);
  assert.deepEqual(workspace.map((comment) => comment.text).sort(), [
    "score docs",
    "sprite docs",
  ]);
  for (const comment of workspace) assert.equal(comment.x, GRID_OFFSET);
  workspace.sort((a, b) => a.y - b.y);
  for (let i = 1; i < workspace.length; i++) {
    assert.ok(
      workspace[i].y - workspace[i - 1].y >= MIN_BLOCK_Y,
      "workspace comments must not overlap",
    );
  }
  const [hatId] = blockByOpcode(s, "event_whenflagclicked");
  assert.ok(
    workspace[0].y > s.blocks[hatId].y,
    "workspace comments are placed below the scripts",
  );

  const stage = sprite(project, "Stage");
  const stageComments = Object.values(stage.comments);
  assert.equal(stageComments.length, 1);
  assert.equal(stageComments[0].text, "stage docs");
  assert.equal(stageComments[0].blockId, null);
});

test("comments survive a VM round trip", async () => {
  const project = compile(`
    // sprite docs
    sprite "S" {
      when greenFlag {
        // greeting
        looks.say("hi");
      }
    }
  `);
  const vm = await loadProject(writeSb3(project, new Map()));
  const target = vm.runtime.targets.find((t) => t.getName() === "S");

  const say = Object.values(target.blocks._blocks).find(
    (block) => block.opcode === "looks_say",
  );
  const attached = target.comments[say.comment];
  assert.equal(attached.text, "greeting");
  assert.equal(attached.blockId, say.id);
  assert.match(target.blocks.toXML(target.comments), /<comment[\s\S]*greeting/);

  const updates = [];
  vm.on("workspaceUpdate", (event) => updates.push(event.xml));
  vm.emitWorkspaceUpdate();
  assert.match(updates.at(-1), /sprite docs/);
});
