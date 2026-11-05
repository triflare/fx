import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatSource } from "../src/formatter.js";
import { applyFixes, lintSources } from "../src/linter.js";
import { parseConfig } from "../src/config.js";
import {
  effectivePreset,
  normalizeLintConfig,
  resolveRuleSeverities,
} from "../src/lint/config.js";
import { parseProjectConfigText } from "../src/lint/config-file.js";
import { PRESETS, RULES } from "../src/lint/rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");
const FILE = path.join("src", "main.tfx");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-lint-"));
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function ruleIds(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.ruleId).sort();
}

/** Lint one inline source with the recommended preset by default. */
function lint(source, options = {}) {
  return lintSources({
    sources: [{ file: FILE, source }],
    ...options,
  }).diagnostics;
}

const CLEAN = `stage {
    let score = 0;
    list names = [];
}

sprite "Cat" {
    let lives = 3;

    when greenFlag {
        lives += 1;
        score = lives;
        names.push("x");
        looks.say(score);
    }
}`;

// ------------------------------------------------------------------- names

test("reports undefined names, implicit variables and division by zero", () => {
  const source = `sprite "Cat" {
    when greenFlag {
        looks.say(missing);
        count = 1;
        ghosts.push(1);
        looks.say(7 / 0);
    }
}`;
  assert.deepEqual(ruleIds(lint(source)), ["FX201", "FX202", "FX204", "FX404"]);
});

test("FX204 is only advertised as fixable when a fix exists", () => {
  const fixable = lint(`sprite "Cat" {
    when greenFlag {
        count = 1;
    }
}`).find((entry) => entry.ruleId === "FX204");
  assert.ok(fixable);
  assert.equal(fixable.fixable, true);
  assert.ok(fixable.fix);

  // A stage script without a `stage {` block has nowhere to insert a fix.
  const stage = lint("when greenFlag {\n    count = 1;\n}\n").find(
    (entry) => entry.ruleId === "FX204",
  );
  assert.ok(stage);
  assert.equal(stage.fixable, false);
  assert.equal(stage.fix, undefined);
});

test("leaves a project with declared names alone", () => {
  assert.deepEqual(lint(CLEAN), []);
});

test("diagnostics carry a full source range", () => {
  const source = `sprite "Cat" {
    when greenFlag {
        looks.say(nope);
    }
}`;
  const [diagnostic] = lint(source).filter((entry) => entry.ruleId === "FX201");
  assert.equal(diagnostic.file, FILE);
  assert.equal(diagnostic.line, 3);
  assert.equal(diagnostic.column, 19);
  assert.equal(diagnostic.endLine, 3);
  assert.equal(diagnostic.endColumn, 23);
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.category, "names");
});

test("reports shadowing, unused state and case collisions", () => {
  const source = `stage {
    let Score = 0;
}

sprite "Cat" {
    let score = 1;
    let spare = 2;
    list Score = [];

    when greenFlag {
        looks.say(score);
        score = 2;
    }

    function greet(Name) {
        looks.say("hi");
    }
}`;
  const ids = ruleIds(lint(source, { strict: true }));
  assert.ok(ids.includes("FX206"), `expected FX206 in ${ids}`);
  assert.ok(ids.includes("FX208"), `expected FX208 in ${ids}`);
  assert.ok(ids.includes("FX207"), `expected FX207 in ${ids}`);
  assert.ok(ids.includes("FX211"), `expected FX211 in ${ids}`);
});

// ------------------------------------------------------------ control flow

test("reports unreachable statements and returns outside functions", () => {
  const source = `sprite "Cat" {
    when greenFlag {
        return;
        looks.show();
    }
}`;
  const ids = ruleIds(lint(source));
  assert.ok(ids.includes("FX101"));
  assert.ok(ids.includes("FX307"));
});

test("checks returning functions and value returns", () => {
  const source = `sprite "Cat" {
    returning function maybe(flag) {
        if (flag) {
            return "yes";
        }
    }

    function plain() {
        return 1;
    }

    when greenFlag {
        looks.say(maybe(true));
        plain();
    }
}`;
  const ids = ruleIds(lint(source));
  assert.ok(ids.includes("FX308"));
  assert.ok(ids.includes("FX309"));
});

test("reports dead loops, constant conditions and yielding warps", () => {
  const source = `sprite "Cat" {
    when greenFlag {
        repeat (0) {
            looks.show();
        }
        while true {
            looks.changeSize(1);
        }
        control.stop();
        looks.show();
    }

    warp function pause() {
        control.wait(1);
    }

    when greenFlag {
        pause();
    }
}`;
  const ids = ruleIds(lint(source));
  assert.ok(ids.includes("FX304"), `expected FX304 in ${ids}`);
  assert.ok(ids.includes("FX302"), `expected FX302 in ${ids}`);
  assert.ok(ids.includes("FX301"), `expected FX301 in ${ids}`);
  assert.ok(ids.includes("FX506"), `expected FX506 in ${ids}`);
  assert.ok(ids.includes("FX101"), `expected FX101 in ${ids}`);
});

test("does not report an infinite loop that calls a function", () => {
  const source = `sprite "Cat" {
    function tick() {
        looks.changeSize(1);
    }

    when greenFlag {
        forever {
            tick();
        }
    }
}`;
  assert.deepEqual(lint(source), []);
});

// ------------------------------------------------------------ presets/rules

const NESTED = `sprite "Cat" {
    when greenFlag {
        while true {
            if (true) {
                if (true) {
                    if (true) {
                        if (true) {
                            looks.show();
                        }
                    }
                }
            }
        }
    }
}`;

test("presets escalate from minimal to strict", () => {
  const minimal = lint(NESTED, {
    lintConfig: { extends: "minimal", rules: {} },
  });
  assert.deepEqual(ruleIds(minimal), []);

  const recommended = ruleIds(lint(NESTED));
  assert.ok(recommended.includes("FX301"));
  assert.ok(recommended.includes("FX302"));
  assert.ok(!recommended.includes("FX901"));

  const strict = ruleIds(lint(NESTED, { strict: true }));
  assert.ok(strict.includes("FX901"));
  assert.ok(strict.includes("FX403"));
});

test("severity overrides enable and disable rules", () => {
  const off = ruleIds(lint(NESTED, { overrides: { FX301: "off" } }));
  assert.ok(!off.includes("FX301"));

  const unusedParameter = `sprite "Cat" {
    function greet(name) {
        looks.say("hi");
    }

    when greenFlag {
        greet("x");
    }
}`;
  const enabled = lint(unusedParameter, {
    lintConfig: { extends: "minimal", rules: {} },
    overrides: { FX207: "error" },
  });
  assert.deepEqual(ruleIds(enabled), ["FX207"]);
  assert.equal(enabled[0].severity, "error");
});

test("resolves configured rule severities", () => {
  const severities = resolveRuleSeverities(
    normalizeLintConfig({
      extends: "minimal",
      rules: { FX201: "warn", FX404: "off" },
    }),
  );
  assert.equal(severities.get("FX201"), "warning");
  assert.equal(severities.get("FX404"), "off");
  assert.equal(severities.get("FX901"), "off");
  assert.equal(severities.get("FX203"), "off");
});

test("strict escalates weaker presets without downgrading stronger ones", () => {
  assert.equal(
    effectivePreset({ extends: "minimal", rules: {} }, true),
    "strict",
  );
  assert.equal(effectivePreset({ extends: "all", rules: {} }, true), "all");
  assert.equal(effectivePreset({ extends: "all", rules: {} }, false), "all");
});

test("stage names read by sprites are not reported unused", () => {
  const source = `let score = 0;

sprite "Cat" {
    when greenFlag {
        score = 1;
    }
}`;
  assert.ok(!ruleIds(lint(source, { strict: true })).includes("FX208"));
});

test("FX204 only offers a fix inside the target that owns the declaration", () => {
  const sprite = lintSources({
    sources: [
      {
        file: FILE,
        source:
          'sprite "Cat" {\n    when greenFlag {\n        count = 1;\n    }\n}',
      },
    ],
  }).diagnostics.find((entry) => entry.ruleId === "FX204");
  assert.ok(sprite);
  assert.equal(sprite.fix.file, FILE);
  assert.equal(sprite.fix.line, 1);
  assert.equal(sprite.fix.column, 'sprite "Cat" {'.indexOf("{") + 1);

  // A stage script without a `stage {` block has no brace to insert into.
  const stage = lintSources({
    sources: [{ file: FILE, source: "when greenFlag {\n    count = 1;\n}\n" }],
  }).diagnostics.find((entry) => entry.ruleId === "FX204");
  assert.ok(stage);
  assert.equal(stage.fix, undefined);
});

test("FX204 fixes insert after a brace on the next line", () => {
  const source =
    'sprite "Cat"\n{\n    when greenFlag {\n        count = 1;\n    }\n}';
  const diagnostic = lint(source).find((entry) => entry.ruleId === "FX204");
  assert.ok(diagnostic);
  assert.equal(diagnostic.fix.line, 2);
  assert.equal(diagnostic.fix.column, 1);
  const applied = applyFixes([{ file: FILE, source }], [diagnostic]);
  assert.match(applied.sources.get(FILE), /\{\n {4}let count = 0;\n/);
});

test("FX204 fixes stay inside a block closed on the same line", () => {
  const source = 'sprite "Cat" { when greenFlag { count = 1; } }';
  const diagnostic = lint(source).find((entry) => entry.ruleId === "FX204");
  assert.ok(diagnostic);
  const applied = applyFixes([{ file: FILE, source }], [diagnostic]);
  assert.equal(
    applied.sources.get(FILE),
    'sprite "Cat" {\n    let count = 0; when greenFlag { count = 1; } }',
  );
});

test("fixes preserve CRLF line endings", () => {
  const source =
    'sprite "Cat" {\r\n    when greenFlag {\r\n        count = 1;\r\n    }\r\n}\r\n';
  const diagnostics = lint(source);
  const applied = applyFixes([{ file: FILE, source }], diagnostics);
  const fixed = applied.sources.get(FILE);
  assert.ok(
    fixed.includes("{\r\n    let count = 0;\r\n    when greenFlag"),
    fixed,
  );
  assert.equal(fixed.replace(/\r\n/g, "").includes("\n"), false);
});

test("editor config reader exposes lint settings", () => {
  const parsed = parseProjectConfigText(`project:
  name: Demo
  extensions:
    - extensions/legacy.js
fx:
  partialSprites: true
  lint:
    extends: strict
    rules:
      FX201: warn
vendor:
  signals: extensions/signals.js
`);
  assert.equal(parsed.config.fx.partialSprites, true);
  assert.equal(parsed.lintConfig.extends, "strict");
  assert.deepEqual(parsed.lintConfig.rules, { FX201: "warning" });
  assert.deepEqual([...parsed.declaredExtensions].sort(), [
    "legacy",
    "signals",
  ]);

  const invalid = parseProjectConfigText("fx: [");
  assert.match(invalid.error, /unexpected end|flow sequence/i);
  assert.deepEqual(invalid.declaredExtensions, []);
});

test("declared extensions are not unknown blocks without metadata", () => {
  const source = `sprite "Cat" {
    when greenFlag {
        signals.emitEvent("go");
    }
}`;
  assert.deepEqual(
    lint(source, { declaredExtensions: ["signals"] }).filter(
      (entry) => entry.ruleId === "FX709",
    ),
    [],
  );
  const loaded = lint(source, {
    declaredExtensions: ["signals"],
    extensionCatalog: {
      "signals.other": { opcode: "signals_other", kind: "command" },
    },
  });
  assert.deepEqual(ruleIds(loaded), ["FX709"]);
});

test("rejects invalid lint configuration", () => {
  assert.throws(
    () => normalizeLintConfig({ extends: "everything" }),
    /unknown lint preset/,
  );
  assert.throws(
    () => normalizeLintConfig({ rules: { FX999: "error" } }),
    /unknown lint rule/,
  );
  assert.throws(
    () => normalizeLintConfig({ rules: { FX201: "loud" } }),
    /must be one of/,
  );
  const { fx } = parseConfig(`
fx:
  lint:
    extends: strict
    rules:
      FX201: warn
      FX203: off
`);
  assert.equal(fx.lint.extends, "strict");
  assert.deepEqual(fx.lint.rules, { FX201: "warning", FX203: "off" });
});

// ------------------------------------------------------------ suppressions

test("supports next-line and range suppressions", () => {
  const nextLine = `sprite "Cat" {
    when greenFlag {
        // fx-lint-disable-next-line FX201
        looks.say(nope);
        looks.say(alsoNope);
    }
}`;
  const result = lintSources({ sources: [{ file: FILE, source: nextLine }] });
  assert.deepEqual(ruleIds(result.diagnostics), ["FX201"]);
  assert.equal(result.summary.suppressed, 1);

  const ranged = `sprite "Cat" {
    when greenFlag {
        // fx-lint-disable FX201
        looks.say(first);
        // fx-lint-enable FX201
        looks.say(second);
    }
}`;
  const rangedResult = lint(ranged);
  assert.deepEqual(ruleIds(rangedResult), ["FX201"]);
  assert.match(rangedResult[0].message, /second/);
});

test("supports file-level suppressions", () => {
  const source = `// fx-lint-disable-file FX404
sprite "Cat" {
    when greenFlag {
        looks.say(1 / 0);
    }
}`;
  assert.deepEqual(lint(source), []);
});

test("reports invalid suppressions and, in strict mode, unused ones", () => {
  const invalid = `sprite "Cat" {
    when greenFlag {
        // fx-lint-disable-next-line FX999
        looks.show();
    }
}`;
  const invalidIds = ruleIds(lint(invalid));
  assert.deepEqual(invalidIds, ["FX001"]);

  const unused = `sprite "Cat" {
    when greenFlag {
        // fx-lint-disable-next-line FX404
        looks.show();
    }
}`;
  assert.deepEqual(lint(unused), []);
  const strict = lint(unused, { strict: true });
  assert.deepEqual(ruleIds(strict), ["FX002"]);
  assert.equal(strict[0].severity, "warning");
});

// ------------------------------------------------------------------ project

test("a runtime while condition does not report an infinite loop", () => {
  const runtime = `sprite "Cat" {
    let running = true;

    when greenFlag {
        while (running) {
            motion.moveSteps(1);
        }
    }
}`;
  assert.ok(!ruleIds(lint(runtime)).includes("FX301"));

  const constant = `sprite "Cat" {
    when greenFlag {
        while (true) {
            motion.moveSteps(1);
        }
    }
}`;
  assert.ok(ruleIds(lint(constant)).includes("FX301"));
});

test("reports partial sprites that the project cannot merge", () => {
  const fragment = `partial sprite "Cat" {
    when greenFlag {
        looks.show();
    }
}`;
  assert.deepEqual(ruleIds(lint(fragment)), ["FX803", "FX804"]);

  const enabled = lint(fragment, {
    config: { fx: { partialSprites: true } },
  });
  assert.deepEqual(ruleIds(enabled), ["FX804"]);

  const merged = `sprite "Cat" {
    costumes: {
        icon: "cat.svg"
    };
}

partial sprite "Cat" {
    when greenFlag {
        looks.show();
    }
}`;
  const withBase = lintSources({
    sources: [{ file: FILE, source: merged }],
    config: { fx: { partialSprites: true } },
  });
  assert.deepEqual(
    withBase.diagnostics.filter((entry) => entry.ruleId.startsWith("FX8")),
    [],
  );
});

test("reports missing, unsupported and unused assets", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "assets", "used.svg"), "<svg/>");
    fs.writeFileSync(path.join(dir, "assets", "photo.bmp"), "bmp");
    fs.writeFileSync(path.join(dir, "assets", "unused.svg"), "<svg/>");

    const source = `sprite "Cat" {
    costumes: {
        used: "../assets/used.svg",
        bad: "../assets/photo.bmp",
        missing: "../assets/gone.svg"
    };
}`;
    const result = lintSources({
      sources: [{ file: path.join(dir, "src", "main.tfx"), source }],
      rootDir: dir,
    });
    const ids = ruleIds(result.diagnostics);
    assert.ok(ids.includes("FX701"), `expected FX701 in ${ids}`);
    assert.ok(ids.includes("FX702"), `expected FX702 in ${ids}`);
    assert.ok(ids.includes("FX703"), `expected FX703 in ${ids}`);
    const unused = result.diagnostics.find((entry) => entry.ruleId === "FX703");
    assert.match(unused.file, /unused\.svg$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("asset checks resolve a relative rootDir", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "assets", "used.svg"), "<svg/>");
    const source = `sprite "Cat" {
    costumes: {
        used: "../assets/used.svg"
    };
}`;
    const result = lintSources({
      sources: [{ file: path.join(dir, "src", "main.tfx"), source }],
      rootDir: path.relative(process.cwd(), dir),
    });
    assert.deepEqual(
      result.diagnostics.filter((entry) => entry.ruleId === "FX703"),
      [],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reports unpinned and unavailable extensions", () => {
  const dir = tmp();
  try {
    const configText = `project:
  name: "Demo"
vendor:
  ext: https://example.test/ext.js
`;
    fs.writeFileSync(path.join(dir, "fx.yml"), configText);
    const config = parseConfig(configText);
    const source = `sprite "Cat" {
    when greenFlag {
        looks.show();
    }
}`;
    const result = lintSources({
      sources: [{ file: path.join(dir, "src", "main.tfx"), source }],
      config,
      configPath: path.join(dir, "fx.yml"),
      configDir: dir,
      rootDir: dir,
    });
    const ids = ruleIds(result.diagnostics);
    assert.ok(ids.includes("FX706"), `expected FX706 in ${ids}`);
    assert.ok(ids.includes("FX708"), `expected FX708 in ${ids}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------- cli

function project(source) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), source);
  return dir;
}

test("lint --json reports stable structured diagnostics", () => {
  const dir = project(`sprite "Cat" {
    when greenFlag {
        looks.say(missing);
        count = 1;
    }
}`);
  try {
    const result = run(["lint", "--json"], dir);
    assert.equal(result.status, 1, result.stderr);
    const document = JSON.parse(result.stdout);
    assert.equal(document.command, "lint");
    assert.equal(document.ok, false);
    assert.deepEqual(
      document.data.diagnostics.map((entry) => entry.ruleId),
      ["FX201", "FX204"],
    );
    assert.equal(document.data.diagnostics[0].file, FILE);
    assert.equal(document.data.summary.errors, 2);
    assert.equal(document.data.preset, "recommended");

    const again = run(["lint", "--json"], dir);
    assert.equal(again.stdout, result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint does not change files without --fix, and repairs FX204 with it", () => {
  const dir = project(`sprite "Cat" {
    when greenFlag {
        looks.show();
        count = 1;
    }
}`);
  try {
    const before = fs.readFileSync(path.join(dir, FILE), "utf8");
    const plain = run(["lint"], dir);
    assert.equal(plain.status, 1, plain.stderr);
    assert.equal(fs.readFileSync(path.join(dir, FILE), "utf8"), before);

    const fixed = run(["lint", "--fix"], dir);
    assert.equal(fixed.status, 0, fixed.stderr);
    const after = fs.readFileSync(path.join(dir, FILE), "utf8");
    assert.match(after, /\n {4}let count = 0;\n/);
    assert.match(after, /when greenFlag/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint --strict keeps a stronger preset and reports it", () => {
  const dir = project(
    'sprite "Cat" {\n    when greenFlag {\n        looks.show();\n    }\n}\n',
  );
  try {
    fs.writeFileSync(
      path.join(dir, "fx.yml"),
      'project:\n  name: "Demo"\nfx:\n  lint:\n    extends: all\n',
    );
    const result = run(["lint", "--json", "--strict"], dir);
    const document = JSON.parse(result.stdout);
    assert.equal(document.data.preset, "all");
    assert.equal(document.data.strict, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bare --rule enables the rule at its default severity", () => {
  const dir = project(`sprite "Cat" {
    let spare = 1;

    when greenFlag {
        looks.show();
    }
}`);
  try {
    const result = run(
      ["lint", "--preset", "minimal", "--rule", "FX208", "--json"],
      dir,
    );
    assert.equal(result.status, 0, result.stderr);
    const [unused] = JSON.parse(result.stdout).data.diagnostics;
    assert.equal(unused.ruleId, "FX208");
    assert.equal(unused.severity, "warning");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linting one file uses the project but reports only that file", () => {
  const dir = project("stage {\n    let score = 0;\n}\n");
  try {
    fs.writeFileSync(
      path.join(dir, "src", "other.tfx"),
      'sprite "Cat" {\n    when greenFlag {\n        score = 1;\n        looks.say(score);\n    }\n}\n',
    );
    const result = run(["lint", "src/other.tfx", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const document = JSON.parse(result.stdout);
    assert.deepEqual(document.data.files, ["src/other.tfx"]);
    assert.deepEqual(document.data.diagnostics, []);
    assert.equal(document.data.summary.files, 1);
    assert.equal(document.data.summary.errors, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint --strict fails on warnings and --rule can switch them off", () => {
  const dir = project(`sprite "Cat" {
    let spare = 1;

    when greenFlag {
        looks.show();
    }
}`);
  try {
    assert.equal(run(["lint"], dir).status, 0);
    assert.equal(run(["lint", "--strict"], dir).status, 1);
    assert.equal(
      run(["lint", "--strict", "--rule", "FX208=off"], dir).status,
      0,
    );
    const selected = run(
      ["lint", "--preset", "minimal", "--rule", "FX201"],
      dir,
    );
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(run(["lint", "--rule", "FX999=error"], dir).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("formatting does not create lint diagnostics", () => {
  const messy = `sprite "Cat"{when greenFlag{looks.say(nope);count=1;}}`;
  const formatted = formatSource(messy, FILE);
  assert.deepEqual(ruleIds(lint(formatted)), ruleIds(lint(messy)));
});

test("every example is clean under the recommended preset", () => {
  const examples = path.join(root, "examples");
  for (const name of fs.readdirSync(examples)) {
    const dir = path.join(examples, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".tfx"));
    if (files.length === 0) continue;
    const configPath = path.join(dir, "fx.yml");
    const config = fs.existsSync(configPath)
      ? parseConfig(fs.readFileSync(configPath, "utf8"))
      : null;
    const result = lintSources({
      sources: files.map((file) => ({
        file: path.join(dir, file),
        source: fs.readFileSync(path.join(dir, file), "utf8"),
      })),
      config,
      configPath: fs.existsSync(configPath) ? configPath : null,
      configDir: dir,
      rootDir: dir,
    });
    assert.deepEqual(
      result.diagnostics.map((entry) => `${entry.ruleId} ${entry.message}`),
      [],
      `${name} should lint clean`,
    );
  }
});

test("preset and rule tables stay consistent", () => {
  for (const name of ["minimal", "recommended", "strict"]) {
    for (const id of PRESETS[name]) assert.ok(RULES[id], `${name}: ${id}`);
  }
  assert.ok(PRESETS.strict.length > PRESETS.recommended.length);
  assert.ok(PRESETS.recommended.length > PRESETS.minimal.length);
});
