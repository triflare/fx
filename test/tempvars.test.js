import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.js";
import { CATALOG } from "../src/catalog.js";
import { compile, Compiler } from "../src/compiler.js";
import { decompileProject } from "../src/decompiler.js";
import { formatSource } from "../src/formatter.js";
import {
  FEATURES,
  disableFeature,
  enableFeature,
  loadFeatureExtensions,
  updateFeature,
} from "../src/features.js";
import { parseConfig } from "../src/config.js";
import { lintSources } from "../src/linter.js";
import { DEFAULT_LINT } from "../src/lint/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");
const fork = path.join(root, "vendor/tempvars/fx-tempvars.js");
const FEATURE = "temporaryvariables";
const EXTENSION_URLS = { fxTempVars: "data:text/javascript;base64," };

function tempProject(config = 'project:\n  name: "Demo"\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-tempvars-"));
  const configPath = path.join(dir, "fx.yml");
  fs.writeFileSync(configPath, config);
  return { dir, configPath };
}

function compiled(source, extensionUrls = EXTENSION_URLS) {
  return compile(parse(source, "tempvars.tfx"), {
    project: {},
    extensionUrls,
  });
}

function opcodes(project) {
  return project.targets
    .flatMap((target) =>
      Object.values(target.blocks).map((block) => block.opcode),
    )
    .filter((opcode) => opcode.startsWith("fxTempVars_"))
    .sort();
}

test("the vendored fork registers fxTempVars and keeps attribution", () => {
  const source = fs.readFileSync(fork, "utf8");
  assert.match(source, /id: "fxTempVars"/);
  assert.match(source, /ext_fxTempVars = extension/);
  assert.doesNotMatch(source, /id: "lmsTempVars2"/);
  assert.doesNotMatch(source, /ext_lmsTempVars2/);
  assert.match(source, /License: MIT AND LGPL-3\.0/);
  assert.match(source, /By: LilyMakesThings/);
});

test("thread/runtime declarations and sigils emit the fork's blocks", () => {
  const { project } = compiled(`sprite "Cat" {
when greenFlag {
thread let hits = 1;
thread let empty;
runtime let high = 2;
$hits += 3;
$$high = $hits;
looks.say($$high);
}
}`);
  assert.deepEqual(opcodes(project), [
    "fxTempVars_changeThreadVariable",
    "fxTempVars_getRuntimeVariable",
    "fxTempVars_getThreadVariable",
    "fxTempVars_setRuntimeVariable",
    "fxTempVars_setRuntimeVariable",
    "fxTempVars_setThreadVariable",
    "fxTempVars_setThreadVariable",
  ]);

  const blocks = project.targets.flatMap((target) =>
    Object.values(target.blocks),
  );
  const firstSet = blocks.find(
    (block) => block.opcode === "fxTempVars_setThreadVariable",
  );
  assert.deepEqual(firstSet.inputs.VAR, [1, [10, "hits"]]);
  assert.deepEqual(firstSet.inputs.STRING, [1, [10, "1"]]);

  // `thread let empty;` uses the upstream default value.
  const empties = blocks.filter(
    (block) =>
      block.opcode === "fxTempVars_setThreadVariable" &&
      block.inputs.VAR[1][1] === "empty",
  );
  assert.equal(empties.length, 1);
  assert.deepEqual(empties[0].inputs.STRING, [1, [10, "0"]]);
});

test("every tempvars catalog entry compiles and decompiles", () => {
  const entries = Object.entries(CATALOG).filter(
    ([name]) => name.split(".")[0] === "tempvars",
  );
  assert.equal(entries.length, 13);

  for (const [name, entry] of entries) {
    const inputs = Object.entries(entry.inputs || {}).filter(
      ([, spec]) => spec.type !== "substack",
    );
    const args = inputs.map(([input]) => (input === "VAR" ? '"x"' : "1"));
    const call = `${name}(${args.join(", ")})`;
    let statement;
    if (entry.inputs?.SUBSTACK) statement = `${call} {\n    looks.show();\n}`;
    else if (entry.kind === "reporter" || entry.kind === "boolean")
      statement = `looks.say(${call});`;
    else statement = `${call};`;

    const { project } = compiled(
      `sprite "S" {\nwhen greenFlag {\n${statement}\n}\n}`,
    );
    const emitted = project.targets.flatMap((target) =>
      Object.values(target.blocks),
    );
    assert.ok(
      emitted.some((block) => block.opcode === entry.opcode),
      `${name} did not emit ${entry.opcode}`,
    );

    const source = decompileProject(project);
    assert.doesNotMatch(source, /unsupported block/);
    assert.doesNotMatch(source, /\/\* unknown/);
    assert.doesNotThrow(() => parse(source, "roundtrip.tfx"));
  }
});

test("a missing feature fails with the setup command", () => {
  assert.throws(
    () => compiled('sprite "S" { when greenFlag { thread let n = 1; } }', {}),
    /fx feature temporaryvariables enable/,
  );
});

test("unsupported operators, invalid sigils and reserved names are errors", () => {
  assert.throws(
    () => compiled('sprite "S" { when greenFlag { $n -= 1; } }'),
    /only support "=" and "\+="/,
  );
  assert.throws(
    () => compiled('sprite "S" { when greenFlag { $ = 1; } }'),
    /Invalid temporary variable reference/,
  );
  assert.throws(
    () => compiled('sprite "S" { let $x = 1; }'),
    /reserved for temporary variables/,
  );
  assert.throws(
    () => compiled('sprite "S" { when greenFlag { thread let $x = 1; } }'),
    /cannot start with "\$"/,
  );
  assert.throws(
    () => new Compiler({}).compile(parse('sprite "S" { function f($p) { } }')),
    /reserved for temporary variables/,
  );
});

test("decompiler uses sugar for safe names and calls for unsafe ones", () => {
  const { project } = compiled(`sprite "S" {
when greenFlag {
thread let hits = 1;
$hits += 3;
$$best = $hits;
tempvars.setThread("hello world", 1);
}
}`);
  const source = decompileProject(project);
  assert.match(source, /\$hits \+= 3;/);
  assert.match(source, /\$\$best = \$hits;/);
  assert.match(source, /tempvars\.setThread\("hello world", "1"\);/);
});

test("dynamic temp-variable names survive decompilation and recompilation", () => {
  for (const name of ["sensing.answer()", "key"]) {
    const { project } = compiled(`sprite "S" {
let key = "hits";
when greenFlag {
tempvars.setThread(${name}, 1);
tempvars.changeThread(${name}, 2);
tempvars.setRuntime(${name}, 3);
tempvars.changeRuntime(${name}, 4);
looks.say(tempvars.thread(${name}));
looks.say(tempvars.runtime(${name}));
}
}`);
    for (const target of project.targets) target.costumes = [];
    const source = decompileProject(project);
    for (const method of [
      "setThread",
      "changeThread",
      "setRuntime",
      "changeRuntime",
      "thread",
      "runtime",
    ]) {
      assert.ok(source.includes(`tempvars.${method}(${name}`), source);
    }
    const rebuilt = compiled(source).project;
    assert.deepEqual(opcodes(rebuilt), opcodes(project));
    for (const target of rebuilt.targets) target.costumes = [];
    assert.equal(decompileProject(rebuilt), source);
  }
});

test("upstream lmsTempVars2 blocks stay plain calls", () => {
  const catalog = {
    "lmsTempVars2.setThreadVariable": {
      opcode: "lmsTempVars2_setThreadVariable",
      kind: "command",
      inputs: {
        VAR: { type: "string" },
        STRING: { type: "string" },
      },
    },
  };
  const project = {
    targets: [
      {
        isStage: true,
        name: "Stage",
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        blocks: {
          hat: {
            opcode: "event_whenflagclicked",
            next: "b1",
            topLevel: true,
            parent: null,
            inputs: {},
            fields: {},
          },
          b1: {
            opcode: "lmsTempVars2_setThreadVariable",
            next: null,
            parent: "hat",
            inputs: { VAR: [1, [10, "x"]], STRING: [1, [10, "1"]] },
            fields: {},
          },
        },
      },
    ],
  };
  const source = decompileProject(project, { catalog });
  assert.match(source, /lmsTempVars2\.setThreadVariable\("x", "1"\);/);
  assert.doesNotMatch(source, /\$x/);
});

test("formatter prints and preserves the new declarations", () => {
  const source =
    'sprite "S"{when greenFlag{thread let n=1;runtime let m=2;$n+=1;$$m+=1;}}';
  const formatted = formatSource(source, "fmt.tfx");
  assert.equal(
    formatted,
    `sprite "S" {
    when greenFlag {
        thread let n = 1;
        runtime let m = 2;
        $n += 1;
        $$m += 1;
    }
}
`,
  );
  assert.equal(formatSource(formatted, "fmt.tfx"), formatted);
});

test("feature enable, update and disable manage the project file", async () => {
  const { dir, configPath } = tempProject();
  const enabled = enableFeature({
    configPath,
    configDir: dir,
    name: FEATURE,
  });
  assert.equal(enabled.file, "./extensions/fx-tempvars.js");
  assert.equal(enabled.changed, true);
  assert.equal(enabled.configChanged, true);
  assert.ok(fs.existsSync(enabled.path));
  assert.ok(
    fs.readFileSync(enabled.path).equals(fs.readFileSync(fork)),
    "the installed copy must be the packaged fork, byte for byte",
  );
  const text = fs.readFileSync(configPath, "utf8");
  assert.ok(text.includes('project:\n  name: "Demo"'));
  assert.match(text, /features:/);
  assert.match(
    text,
    new RegExp(`${FEATURE}: "\\./extensions/fx-tempvars\\.js"`),
  );

  const loaded = parseConfig(text);
  assert.deepEqual(loaded.features, [
    { name: FEATURE, file: "./extensions/fx-tempvars.js" },
  ]);
  const extensions = await loadFeatureExtensions({
    configDir: dir,
    config: loaded,
  });
  assert.deepEqual(extensions.ids, ["fxTempVars"]);
  assert.match(
    extensions.extensionUrls.fxTempVars,
    /^data:text\/javascript;base64,/,
  );
  assert.deepEqual(extensions.warnings, []);

  // Enabling again is idempotent.
  const again = enableFeature({ configPath, configDir: dir, name: FEATURE });
  assert.equal(again.changed, false);
  assert.equal(again.configChanged, false);

  // A modified copy is not replaced silently.
  fs.appendFileSync(enabled.path, "// local edit\n");
  assert.throws(
    () => enableFeature({ configPath, configDir: dir, name: FEATURE }),
    /already installed .* different contents/,
  );

  const dry = updateFeature({
    configPath,
    configDir: dir,
    name: FEATURE,
    dryRun: true,
  });
  assert.equal(dry.changed, true);
  assert.match(dry.diff, /^--- /);
  assert.ok(fs.readFileSync(enabled.path, "utf8").includes("local edit"));

  const updated = updateFeature({ configPath, configDir: dir, name: FEATURE });
  assert.equal(updated.changed, true);
  assert.ok(fs.readFileSync(enabled.path).equals(fs.readFileSync(fork)));

  const disabled = disableFeature({
    configPath,
    configDir: dir,
    name: FEATURE,
  });
  assert.equal(disabled.fileRemoved, true);
  assert.equal(fs.existsSync(enabled.path), false);
  assert.deepEqual(
    parseConfig(fs.readFileSync(configPath, "utf8")).features,
    [],
  );
  assert.throws(
    () => updateFeature({ configPath, configDir: dir, name: FEATURE }),
    /is not enabled/,
  );
});

test("fx feature temporaryvariables enable works from the CLI", () => {
  const { dir } = tempProject();
  const result = spawnSync(
    process.execPath,
    [bin, "feature", FEATURE, "enable"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const installed = path.join(dir, "extensions", "fx-tempvars.js");
  assert.ok(fs.existsSync(installed));
  assert.ok(fs.readFileSync(installed).equals(fs.readFileSync(fork)));
  assert.match(fs.readFileSync(path.join(dir, "fx.yml"), "utf8"), /features:/);

  const update = spawnSync(
    process.execPath,
    [bin, "feature", FEATURE, "update"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /up to date/i);
});

test("lint accepts sigils and flags reserved declaration names", () => {
  const clean = lintSources({
    sources: [
      {
        file: "ok.tfx",
        source:
          'sprite "S" { when greenFlag { thread let n = 0; $n += 1; looks.say($n); } }',
      },
    ],
    lintConfig: DEFAULT_LINT,
  });
  const cleanRules = clean.diagnostics.map((diagnostic) => diagnostic.ruleId);
  assert.ok(!cleanRules.includes("FX201"), "sigils are not undefined names");
  assert.ok(!cleanRules.includes("FX204"), "sigil assignment needs no let");
  assert.ok(!cleanRules.includes("FX214"), "the declaration is valid");

  const reserved = lintSources({
    sources: [{ file: "bad.tfx", source: 'sprite "S" { let $x = 0; }' }],
    lintConfig: DEFAULT_LINT,
  });
  assert.ok(
    reserved.diagnostics.some((diagnostic) => diagnostic.ruleId === "FX214"),
    "FX214 should flag a $ name",
  );
});

test("the temporaryvariables feature is registered", () => {
  assert.equal(FEATURES[FEATURE].extensionId, "fxTempVars");
  assert.ok(fs.existsSync(FEATURES[FEATURE].source));
});
