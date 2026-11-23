import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { DEFAULT_RUN, parseConfig } from "../src/config.js";
import { discoverSources } from "../src/project.js";
import { discoverRuns } from "../src/run/discover.js";
import { parseRunFile, parseRuns } from "../src/run/parse.js";
import {
  disableFeature,
  enableFeature,
  featureEnabled,
  updateFeature,
} from "../src/features.js";
import { RUN_EXIT, runRuns } from "../src/run/runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

const GAME = `
sprite "Thing" {
    let value = "Thing";
    when broadcast("Thing.do") {
        value = "Thing 2";
        run.print("Thing done!");
    }
}
`;

const RUN = `
function main() {
    events.broadcast("Thing.do");
}
`;

function tmpProject({
  run = "true",
  source = GAME,
  runSource = RUN,
  tests = "false",
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-run-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "run"), { recursive: true });
  const fxConfig =
    run === null
      ? 'project:\n  name: "Demo"\n'
      : `project:\n  name: "Demo"\nfx:\n  tests: ${tests}\n  run: ${run}\n`;
  fs.writeFileSync(path.join(dir, "fx.yml"), fxConfig);
  fs.writeFileSync(path.join(dir, "src", "game.tfx"), source);
  if (runSource != null)
    fs.writeFileSync(path.join(dir, "run", "main.run.tfx"), runSource);
  return dir;
}

function run(args, cwd, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    ...options,
  });
}

// ------------------------------------------------------------------- config

test("fx.run accepts true, false and a mapping of overrides", () => {
  assert.equal(parseConfig('project:\n  name: "Demo"\n').fx.run, false);
  assert.deepEqual(parseConfig("fx:\n  run: true\n").fx.run, {
    enabled: true,
    ...DEFAULT_RUN,
  });
  const custom = parseConfig(
    'fx:\n  run:\n    pattern: "scripts/**/*.run.tfx"\n    seed: 7\n    timeout: 500\n    failOnRuntimeError: false\n',
  ).fx.run;
  assert.equal(custom.pattern, "scripts/**/*.run.tfx");
  assert.equal(custom.seed, 7);
  assert.equal(custom.timeout, 500);
  assert.equal(custom.failOnRuntimeError, false);
  assert.equal(custom.ticksPerSecond, DEFAULT_RUN.ticksPerSecond);
  assert.throws(
    () => parseConfig("fx:\n  run:\n    nope: 1\n"),
    /unknown fx.run setting/,
  );
  assert.throws(
    () => parseConfig("fx:\n  run:\n    timeout: 0\n"),
    /positive number of milliseconds/,
  );
});

// ------------------------------------------------------------------- parser

test("run files only allow variables, functions and one parameterless main", () => {
  const parsed = parseRunFile(
    "let shared = 1;\nfunction helper() { return 2; }\nfunction main() { helper(); }\n",
    "main.run.tfx",
  );
  assert.equal(parsed.main.name, "main");
  assert.equal(parsed.helpers.length, 3);

  assert.throws(
    () => parseRunFile('sprite "A" { }', "a.run.tfx"),
    /cannot declare sprites/,
  );
  assert.throws(
    () => parseRunFile("stage { }", "a.run.tfx"),
    /cannot declare a stage/,
  );
  assert.throws(
    () => parseRunFile('test "x" { expect 1 == 1; }', "a.run.tfx"),
    /cannot declare tests/,
  );
  assert.throws(
    () => parseRunFile("looks.say(1);", "a.run.tfx"),
    /may only declare shared variables and functions/,
  );
  assert.throws(
    () => parseRunFile("function main(value) { }", "a.run.tfx"),
    /must not take parameters/,
  );
  assert.throws(
    () =>
      parseRuns([{ file: "helper.run.tfx", source: "function helper() { }" }]),
    /must declare an entry point/,
  );
  assert.throws(
    () =>
      parseRuns([
        { file: "a.run.tfx", source: "function main() { }" },
        { file: "b.run.tfx", source: "function main() { }" },
      ]),
    /Only one run file may declare/,
  );
});

// ---------------------------------------------------------------- discovery

test("run discovery matches the configured glob and builds skip run files", () => {
  const dir = tmpProject();
  try {
    assert.deepEqual(
      discoverRuns({ dir }).map((entry) => entry.relative),
      ["run/main.run.tfx"],
    );
    assert.deepEqual(
      discoverSources(dir).map((file) => path.relative(dir, file)),
      [path.join("src", "game.tfx")],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx build ignores run blocks and ships no run extension", () => {
  const dir = tmpProject({
    source: `
sprite "Thing" {
    let name = "";
    when broadcast("Thing.do") {
        run.print("not in the build");
        name = run.prompt("Your name?");
        run.warn("not in the build either");
        looks.say(name);
    }
}
`,
  });
  try {
    const built = build({ dir });
    const opcodes = built.project.targets.flatMap((target) =>
      Object.values(target.blocks).map((block) => block.opcode),
    );
    assert.ok(!opcodes.some((opcode) => opcode.startsWith("fxRun_")));
    assert.ok(!built.project.extensions.includes("fxRun"));
    assert.equal(built.project.extensionURLs?.fxRun, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- features

test("the run feature toggles fx.run and refuses update", () => {
  const dir = tmpProject({ run: null, runSource: null });
  try {
    const configPath = path.join(dir, "fx.yml");
    const enabled = enableFeature({
      configPath,
      configDir: dir,
      name: "run",
    });
    assert.equal(enabled.changed, true);
    assert.match(fs.readFileSync(configPath, "utf8"), /run: true/);
    assert.equal(featureEnabled({ configPath, name: "run" }), true);

    const disabled = disableFeature({
      configPath,
      configDir: dir,
      name: "run",
    });
    assert.equal(disabled.changed, true);
    assert.equal(disabled.warning, null);
    assert.match(fs.readFileSync(configPath, "utf8"), /run: false/);

    assert.throws(
      () => updateFeature({ configPath, configDir: dir, name: "run" }),
      /no vendored source/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- execution

test("fx run executes main and captures run.print output", async () => {
  const dir = tmpProject();
  try {
    const result = await runRuns({ dir });
    assert.equal(result.exitCode, RUN_EXIT.OK, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.deepEqual(result.prints, ["Thing done!"]);
    assert.equal(result.files[0].file, "run/main.run.tfx");
    assert.equal(result.files[0].entry, "main");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run.warn reports a warning without failing the run", async () => {
  const dir = tmpProject({
    runSource:
      'function main() {\n  run.warn("careful");\n  run.print("after");\n}\n',
  });
  try {
    const result = await runRuns({ dir });
    assert.equal(result.exitCode, RUN_EXIT.OK, JSON.stringify(result));
    assert.deepEqual(result.warnings, ["careful"]);
    assert.deepEqual(result.prints, ["after"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run.error fails the run with its message", async () => {
  const dir = tmpProject({
    runSource: 'function main() {\n  run.error("boom");\n}\n',
  });
  try {
    const result = await runRuns({ dir });
    assert.equal(result.exitCode, RUN_EXIT.FAILED);
    assert.equal(result.error.name, "RunError");
    assert.equal(result.error.message, "boom");
    assert.deepEqual(result.errors, ["boom"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run.assert passes a true condition and fails a false one", async () => {
  const dir = tmpProject({
    runSource:
      'function main() {\n  run.assert(1 == 1, "always true");\n  run.print("passed");\n}\n',
  });
  try {
    const passed = await runRuns({ dir });
    assert.equal(passed.exitCode, RUN_EXIT.OK, JSON.stringify(passed));
    assert.deepEqual(passed.prints, ["passed"]);

    fs.writeFileSync(
      path.join(dir, "run", "main.run.tfx"),
      'function main() {\n  run.assert(1 == 2, "one is not two");\n}\n',
    );
    const failed = await runRuns({ dir });
    assert.equal(failed.exitCode, RUN_EXIT.FAILED);
    assert.equal(failed.error.name, "AssertionError");
    assert.equal(failed.error.message, "one is not two");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run.prompt returns the line from the prompt hook", async () => {
  const dir = tmpProject({
    runSource:
      'let name = "";\nfunction main() {\n  name = run.prompt("Your name?");\n  run.print(operators.join("Hello, ", name));\n}\n',
  });
  const asked = [];
  try {
    const result = await runRuns({
      dir,
      prompt: (message) => {
        asked.push(message);
        return "Ada";
      },
    });
    assert.equal(result.exitCode, RUN_EXIT.OK, JSON.stringify(result));
    assert.deepEqual(asked, ["Your name?"]);
    assert.deepEqual(result.prompts, [
      { message: "Your name?", answer: "Ada" },
    ]);
    assert.deepEqual(result.prints, ["Hello, Ada"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit run file outside run/ is not also compiled as project code", async () => {
  const dir = tmpProject({ runSource: null });
  try {
    fs.writeFileSync(
      path.join(dir, "src", "entry.run.tfx"),
      'function main() { run.print("explicit"); }\n',
    );
    const result = await runRuns({
      dir,
      cwd: dir,
      files: ["src/entry.run.tfx"],
    });
    assert.equal(result.exitCode, RUN_EXIT.OK, JSON.stringify(result));
    assert.deepEqual(result.prints, ["explicit"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("main can call helper functions declared in the run file", async () => {
  const dir = tmpProject({
    runSource: `
        function helper() {
            run.print("ready");
        }
        function main() {
            helper();
        }
    `,
  });
  try {
    const result = await runRuns({ dir });
    assert.equal(result.exitCode, RUN_EXIT.OK, JSON.stringify(result));
    assert.deepEqual(result.prints, ["ready"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runaway runs time out instead of hanging", async () => {
  const dir = tmpProject({
    runSource: 'function main() {\n  events.broadcast("spin");\n}\n',
    source: `
        sprite "Thing" {
            when broadcast("spin") {
                control.forever { }
            }
        }
    `,
  });
  try {
    const result = await runRuns({ dir, timeout: 50 });
    assert.equal(result.exitCode, RUN_EXIT.FAILED);
    assert.equal(result.error.name, "TimeoutError");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project extensions require an explicit run opt-in", async () => {
  const dir = tmpProject();
  const extension = `
class FxRunTestExtension {
  getInfo() {
    return { id: "fxruntestext", name: "Fx Run Test", blocks: [] };
  }
}
Scratch.extensions.register(new FxRunTestExtension());
`;
  try {
    fs.writeFileSync(path.join(dir, "ext.js"), extension);
    fs.writeFileSync(
      path.join(dir, "fx.yml"),
      `project:
  name: "Demo"
  extensions:
    - "./ext.js"
fx:
  tests: false
  run: true
`,
    );

    await assert.rejects(() => runRuns({ dir }), /allow-project-extensions/);

    const allowed = await runRuns({ dir, allowProjectExtensions: true });
    assert.equal(allowed.exitCode, RUN_EXIT.OK, JSON.stringify(allowed));
    assert.deepEqual(allowed.prints, ["Thing done!"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("running disabled fails with a hint to enable the feature", async () => {
  const dir = tmpProject({ run: "false" });
  try {
    await assert.rejects(
      () => runRuns({ dir }),
      (error) => {
        assert.match(error.message, /disabled/);
        assert.match(error.hint, /fx feature run enable/);
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------- CLI

test("fx run reports output, exits 0 and emits JSON", () => {
  const dir = tmpProject();
  try {
    const human = run(["run"], dir);
    assert.equal(human.status, 0, human.stdout + human.stderr);
    assert.equal(human.stdout.trim(), "Thing done!");

    const json = run(["run", "--json"], dir);
    assert.equal(json.status, 0, json.stdout + json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.command, "run");
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data.prints, ["Thing done!"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx run routes warnings and explicit errors to the terminal", () => {
  const dir = tmpProject({
    runSource:
      'function main() {\n  run.warn("careful");\n  run.print("after");\n}\n',
  });
  try {
    const warned = run(["run"], dir);
    assert.equal(warned.status, RUN_EXIT.OK, warned.stderr);
    assert.equal(warned.stdout.trim(), "after");
    assert.match(warned.stderr, /careful/);

    fs.writeFileSync(
      path.join(dir, "run", "main.run.tfx"),
      'function main() {\n  run.error("boom");\n}\n',
    );
    const failed = run(["run"], dir);
    assert.equal(failed.status, RUN_EXIT.FAILED);
    assert.match(failed.stderr, /RunError: boom/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx run reads run.prompt from stdin", () => {
  const dir = tmpProject({
    runSource:
      'let name = "";\nfunction main() {\n  name = run.prompt("Your name?");\n  run.print(operators.join("Hello, ", name));\n}\n',
  });
  try {
    const result = run(["run"], dir, { input: "Ada\n" });
    assert.equal(result.status, RUN_EXIT.OK, result.stderr);
    assert.equal(result.stdout.trim(), "Hello, Ada");
    assert.match(result.stderr, /Your name\?/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx run blocks project extensions unless the flag is passed", () => {
  const dir = tmpProject();
  try {
    fs.writeFileSync(
      path.join(dir, "ext.js"),
      `
class FxRunTestExtension {
  getInfo() {
    return { id: "fxruntestext", name: "Fx Run Test", blocks: [] };
  }
}
Scratch.extensions.register(new FxRunTestExtension());
`,
    );
    fs.writeFileSync(
      path.join(dir, "fx.yml"),
      `project:
  name: "Demo"
  extensions:
    - "./ext.js"
fx:
  tests: false
  run: true
`,
    );

    const blocked = run(["run"], dir);
    assert.equal(blocked.status, RUN_EXIT.ERROR);
    assert.match(
      `${blocked.stdout}${blocked.stderr}`,
      /allow-project-extensions/,
    );

    const allowed = run(["run", "--allow-project-extensions"], dir);
    assert.equal(allowed.status, RUN_EXIT.OK, allowed.stdout + allowed.stderr);
    assert.equal(allowed.stdout.trim(), "Thing done!");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx run exits 2 when running is disabled", () => {
  const dir = tmpProject({ run: "false" });
  try {
    const result = run(["run"], dir);
    assert.equal(result.status, RUN_EXIT.ERROR);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /disabled/);
    assert.match(output, /fx feature run enable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
