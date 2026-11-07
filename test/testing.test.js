import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parser.js";
import { parseConfig, DEFAULT_TESTS } from "../src/config.js";
import { mergePrograms, discoverSources } from "../src/project.js";
import { discoverTests, matchesTestPattern } from "../src/test/discover.js";
import { parseTestFile } from "../src/test/parse.js";
import {
  disableFeature,
  enableFeature,
  featureEnabled,
  updateFeature,
} from "../src/features.js";
import {
  installExternalIOGuard,
  runTests,
  TEST_EXIT,
} from "../src/test/runner.js";
import { createTestReporter, junitReport } from "../src/test/reporters.js";
import {
  createStorage,
  createVm,
  loadProject,
  loadVmModules,
} from "../src/vm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

const GAME = `
sprite "Player" {
    let score = 0;
    list items = ["a"];
    when broadcast("add") {
        score += 1;
    }
}
`;

const TESTS = `
test "state queries" {
    start();
    expect state.variable("score") == 0;
    expect state.list("items").length == 1;
    expect state.sprite("Player").visible;
    expect state.errors().length == 0;
    expect state.ticks() == 0;
}

test "broadcast updates score" {
    reset();
    start();
    broadcast("add");
    step(2);
    expect state.variable("score") == 1;
    expect state.broadcasted("add");
    expect state.ticks() > 0;
}
`;

function tmpProject({
  tests = "true",
  testSource = TESTS,
  source = GAME,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-test-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  const fxConfig =
    tests === null
      ? 'project:\n  name: "Demo"\n'
      : `project:\n  name: "Demo"\nfx:\n  tests: ${tests}\n`;
  fs.writeFileSync(path.join(dir, "fx.yml"), fxConfig);
  fs.writeFileSync(path.join(dir, "src", "game.tfx"), source);
  if (testSource != null)
    fs.writeFileSync(path.join(dir, "test", "score.test.tfx"), testSource);
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function memoryStream() {
  const chunks = [];
  return {
    stream: {
      write: (text) => {
        chunks.push(text);
        return true;
      },
      isTTY: false,
    },
    text: () => chunks.join(""),
  };
}

// ------------------------------------------------------------------- config

test("fx.tests accepts true, false and a mapping of overrides", () => {
  assert.equal(parseConfig('project:\n  name: "Demo"\n').fx.tests, false);
  assert.deepEqual(parseConfig("fx:\n  tests: true\n").fx.tests, {
    enabled: true,
    ...DEFAULT_TESTS,
  });
  const custom = parseConfig(
    'fx:\n  tests:\n    pattern: "specs/**/*.test.tfx"\n    seed: 7\n    timeout: 500\n    failOnRuntimeError: false\n',
  ).fx.tests;
  assert.equal(custom.pattern, "specs/**/*.test.tfx");
  assert.equal(custom.seed, 7);
  assert.equal(custom.timeout, 500);
  assert.equal(custom.failOnRuntimeError, false);
  assert.equal(custom.ticksPerSecond, DEFAULT_TESTS.ticksPerSecond);
  // Trust is an invocation option: a project cannot grant it to itself.
  assert.equal(Object.hasOwn(DEFAULT_TESTS, "allowProjectExtensions"), false);
  assert.throws(
    () => parseConfig("fx:\n  tests:\n    allowProjectExtensions: true\n"),
    /unknown fx.tests setting/,
  );
  assert.throws(
    () => parseConfig("fx:\n  tests:\n    nope: 1\n"),
    /unknown fx.tests setting/,
  );
});

// ------------------------------------------------------------------- parser

test("test declarations, expect statements and member access parse", () => {
  const ast = parse(
    'test "score" {\n  expect state.list("items").length > 0;\n  expect 1 == 2, "one is two";\n}\n',
    "score.test.tfx",
  );
  assert.equal(ast.tests.length, 1);
  assert.equal(ast.tests[0].name, "score");
  const [first, second] = ast.tests[0].body;
  assert.equal(first.type, "Expect");
  assert.equal(first.value.type, "Binary");
  assert.equal(first.value.left.type, "Member");
  assert.equal(first.value.left.property, "length");
  assert.equal(first.value.left.object.segments.join("."), "state.list");
  assert.equal(second.message, "one is two");
});

test("test files reject project declarations", () => {
  assert.throws(
    () => parseTestFile('sprite "A" { }', "a.test.tfx"),
    /cannot declare sprites/,
  );
  assert.throws(
    () => parseTestFile("stage { }", "a.test.tfx"),
    /cannot declare a stage/,
  );
  assert.throws(
    () => parseTestFile("when greenFlag { }", "a.test.tfx"),
    /may only declare tests/,
  );
});

test("a project source cannot declare tests", () => {
  const ast = parse('test "x" { expect 1 == 1; }', "src/game.tfx");
  assert.throws(
    () => mergePrograms([{ ast, file: "src/game.tfx" }]),
    /declared in a project source/,
  );
});

// ---------------------------------------------------------------- discovery

test("test discovery matches the configured glob and builds skip test files", () => {
  const dir = tmpProject();
  try {
    assert.equal(matchesTestPattern("test/score.test.tfx"), true);
    assert.equal(matchesTestPattern("test/nested/a.test.tfx"), true);
    assert.equal(matchesTestPattern("src/score.test.tfx"), false);
    assert.deepEqual(
      discoverTests({ dir }).map((entry) => entry.relative),
      ["test/score.test.tfx"],
    );
    assert.deepEqual(
      discoverSources(dir).map((file) => path.relative(dir, file)),
      [path.join("src", "game.tfx")],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- features

test("enabling and disabling tests edits fx.yml and keeps comments", () => {
  const dir = tmpProject({ tests: null, testSource: null });
  try {
    const configPath = path.join(dir, "fx.yml");
    fs.writeFileSync(
      configPath,
      '# project settings\nproject:\n  name: "Demo"\n\nfx:\n  # keep this comment\n  partialSprites: false\n',
    );
    const enabled = enableFeature({
      configPath,
      configDir: dir,
      name: "tests",
    });
    assert.equal(enabled.changed, true);
    const text = fs.readFileSync(configPath, "utf8");
    assert.match(text, /fx:\n(?:.*\n)* {2}tests: true\n/);
    assert.match(text, /# keep this comment/);
    assert.match(text, /# project settings/);
    assert.equal(featureEnabled({ configPath, name: "tests" }), true);

    const disabled = disableFeature({
      configPath,
      configDir: dir,
      name: "tests",
    });
    assert.equal(disabled.changed, true);
    assert.equal(
      disabled.warning,
      "Testing will become a core feature in a future version.",
    );
    assert.match(fs.readFileSync(configPath, "utf8"), /tests: false/);
    assert.equal(
      disableFeature({ configPath, configDir: dir, name: "tests" }).changed,
      false,
    );

    assert.throws(
      () => updateFeature({ configPath, configDir: dir, name: "tests" }),
      /no vendored source/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx feature tests reports status, enables, warns on disable and refuses update", () => {
  const dir = tmpProject({ tests: null, testSource: null });
  try {
    const enabled = run(["feature", "tests", "enable"], dir);
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.match(
      fs.readFileSync(path.join(dir, "fx.yml"), "utf8"),
      /tests: true/,
    );

    const status = run(["feature", "tests"], dir);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Testing/);
    assert.match(status.stdout, /enabled/);

    const disabled = run(["feature", "tests", "disable", "--yes"], dir);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.match(
      disabled.stderr,
      /Testing will become a core feature in a future version\./,
    );

    const update = run(["feature", "tests", "update"], dir);
    assert.equal(update.status, 1);
    assert.match(update.stderr, /no vendored source/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- runner

test("tests run headlessly and report passing results", async () => {
  const dir = tmpProject();
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.OK);
    assert.equal(result.counts.tests, 2);
    assert.equal(result.counts.passed, 2);
    assert.equal(result.seed, DEFAULT_TESTS.seed);
    assert.deepEqual(
      result.files.map((file) => file.file),
      ["test/score.test.tfx"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tests call project command and returning blocks", async () => {
  const source = `
        sprite "Player" {
            let score = 0;
            function addScore(amount) {
                score += amount;
            }
            returning function points() {
                return score;
            }
        }
    `;
  const dir = tmpProject({
    source,
    testSource: `
        test "project blocks" {
            start();
            Player.addScore(2);
            expect Player.points() == 2;
            addScore(3);
            expect state.variable("score") == 5;
            expect points() == 5;
        }
    `,
  });
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));
    assert.equal(result.counts.passed, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown project block fails clearly and lists what exists", async () => {
  const source = `
        sprite "Player" {
            function reset() { }
        }
    `;
  const dir = tmpProject({
    source,
    testSource: 'test "typo" { missing(); }\n',
  });
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.FAILED);
    assert.match(
      result.files[0].tests[0].error.message,
      /Unknown test action or project block "missing"\. Available blocks: Player\.reset/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing assertion reports expected, received and a source location", async () => {
  const dir = tmpProject({
    testSource: 'test "fails" {\n  expect 0 > 0;\n}\n',
  });
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.FAILED);
    const failure = result.files[0].tests[0].error;
    assert.equal(failure.name, "AssertionError");
    assert.equal(failure.message, "expected 0 to be greater than 0");
    assert.equal(failure.line, 2);
    assert.equal(failure.received, 0);
    assert.equal(failure.expected, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("broadcastAndWait ignores threads started outside the broadcast", async () => {
  const dir = tmpProject({
    source: `sprite "Player" {
      let pings = 0;
      when greenFlag { forever { control.wait(1); } }
      when broadcast("ping") { pings += 1; }
    }`,
    testSource:
      'test "waits only for its scripts" { start(); step(1); broadcastAndWait("ping"); expect state.variable("pings") == 1; }\n',
  });
  try {
    const result = await runTests({ dir, timeout: 500 });
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("filtering and deterministic reruns work", async () => {
  const dir = tmpProject();
  try {
    const filtered = await runTests({ dir, filter: "broadcast" });
    assert.equal(filtered.counts.tests, 1);
    assert.equal(filtered.files[0].tests[0].name, "broadcast updates score");

    const first = await runTests({ dir });
    const second = await runTests({ dir });
    assert.equal(first.seed, second.seed);
    assert.deepEqual(
      first.files[0].tests.map((item) => [item.name, item.ticks]),
      second.files[0].tests.map((item) => [item.name, item.ticks]),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runaway tests time out instead of hanging", async () => {
  const dir = tmpProject({ testSource: 'test "hangs" { forever { } }\n' });
  try {
    const result = await runTests({ dir, timeout: 50 });
    assert.equal(result.exitCode, TEST_EXIT.FAILED);
    assert.equal(result.files[0].tests[0].error.name, "TimeoutError");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("testing disabled fails with a hint to enable the feature", async () => {
  const dir = tmpProject({ tests: "false" });
  try {
    await assert.rejects(
      () => runTests({ dir }),
      (error) => {
        assert.match(error.message, /disabled/);
        assert.match(error.hint, /fx feature tests enable/);
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- reporters

test("reporters render the same run as terminal, dot, verbose, JSON and JUnit", async () => {
  const dir = tmpProject({
    testSource:
      'test "passes" { expect 1 == 1; }\ntest "fails" { expect 1 == 2; }\n',
  });
  try {
    const render = async (name) => {
      const output = memoryStream();
      const reporter = createTestReporter({
        name,
        stream: output.stream,
        dir,
      });
      const result = await runTests({ dir, onEvent: reporter.onEvent });
      return { text: output.text(), result };
    };

    const terminal = await render("default");
    assert.match(terminal.text, /Test Files/);
    assert.match(terminal.text, /FAIL/);
    assert.match(terminal.text, /expected 1 to equal 2/);

    const dot = await render("dot");
    assert.match(dot.text, /·/);
    assert.match(dot.text, /×/);

    const verbose = await render("verbose");
    assert.match(verbose.text, /✓ passes/);
    assert.match(verbose.text, /× fails/);

    const json = await render("json");
    const document = JSON.parse(json.text.trim());
    assert.equal(document.command, "test");
    assert.equal(document.ok, false);
    assert.equal(document.data.counts.failed, 1);
    assert.ok(Array.isArray(document.data.events));

    const junit = await render("junit");
    assert.match(junit.text, /<testsuites name="fx" tests="2" failures="1"/);
    assert.match(junit.text, /<failure message="expected 1 to equal 2"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reporters show discovered tests as pending, running and completed", async () => {
  const dir = tmpProject({
    testSource: 'test "passes" { expect 1 == 1; }\n',
  });
  try {
    const output = memoryStream();
    const reporter = createTestReporter({
      name: "verbose",
      stream: output.stream,
      dir,
    });
    const result = await runTests({ dir, onEvent: reporter.onEvent });
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));

    const text = output.text();
    assert.match(text, /↓ test\/score\.test\.tfx > passes pending/);
    assert.match(text, /▸ test\/score\.test\.tfx > passes running/);
    assert.match(text, /✓ passes/);

    const renderDefault = async (tty) => {
      const stream = memoryStream();
      const defaultReporter = createTestReporter({
        name: "default",
        stream: stream.stream,
        dir,
        tty,
      });
      const run = await runTests({ dir, onEvent: defaultReporter.onEvent });
      assert.equal(run.exitCode, TEST_EXIT.OK, JSON.stringify(run));
      const rendered = stream.text();
      assert.match(
        rendered,
        /PENDING\s+test\/score\.test\.tfx > passes/,
        rendered,
      );
      assert.match(
        rendered,
        tty
          ? /▸ test\/score\.test\.tfx > passes/
          : /RUNNING\s+test\/score\.test\.tfx > passes/,
        rendered,
      );
      assert.match(rendered, /✓ test\/score\.test\.tfx > passes/, rendered);
    };
    await renderDefault(false);
    await renderDefault(true);

    const discovered = reporter.events.find(
      (event) => event.event === "discovered",
    );
    assert.deepEqual(discovered.files, [
      {
        file: "test/score.test.tfx",
        tests: [{ name: "passes", status: "pending" }],
      },
    ]);
    const running = reporter.events.find(
      (event) => event.event === "test-start",
    );
    assert.equal(running.status, "running");
    const completed = reporter.events.find(
      (event) => event.event === "test-result",
    );
    assert.equal(completed.status, "passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx test exit codes cover passing, failing, empty and invalid runs", () => {
  const passing = tmpProject();
  const failing = tmpProject({
    testSource: 'test "fails" { expect 1 == 2; }\n',
  });
  const empty = tmpProject({ testSource: null });
  try {
    assert.equal(run(["test"], passing).status, TEST_EXIT.OK);
    assert.equal(
      run(["test", "--reporter", "dot"], failing).status,
      TEST_EXIT.FAILED,
    );
    assert.equal(run(["test"], empty).status, TEST_EXIT.ERROR);
    assert.equal(
      run(["test", "--reporter", "nope"], passing).status,
      TEST_EXIT.USAGE,
    );

    const json = run(["test", "--json"], failing);
    assert.equal(json.status, TEST_EXIT.FAILED);
    const document = JSON.parse(json.stdout.trim());
    assert.equal(document.command, "test");
    assert.equal(document.ok, false);
  } finally {
    for (const dir of [passing, failing, empty])
      fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reporters distinguish execution errors from assertion failures", () => {
  const tests = ["passed", "failed", "error", "pending"].map((status) => ({
    name: status,
    status,
    durationMs: 0,
  }));
  const files = [
    { file: "a.test.tfx", tests, durationMs: 0 },
    { file: "b.test.tfx", tests: [tests[2]], durationMs: 0 },
  ];
  const xml = junitReport({
    files,
    counts: { tests: 5, failed: 1, errors: 99 },
    durationMs: 0,
  });
  assert.match(xml, /<testsuites name="fx" tests="5" failures="1" errors="2"/);
  assert.match(
    xml,
    /<testsuite name="a.test.tfx" tests="4" failures="1" errors="1"/,
  );
  assert.match(
    xml,
    /<testsuite name="b.test.tfx" tests="1" failures="0" errors="1"/,
  );
  assert.equal((xml.match(/<error /g) ?? []).length, 2);
  for (const name of ["default", "verbose", "dot"]) {
    const output = memoryStream();
    const reporter = createTestReporter({
      name,
      color: true,
      stream: output.stream,
    });
    reporter.onEvent({ event: "test-result", ...tests[2] });
    assert.ok(output.text().includes("\x1b[31m×\x1b[0m"));
    reporter.onEvent({ event: "file-result", ...files[0], status: "error" });
    if (name !== "dot")
      assert.match(output.text(), /4 tests \| 1 failed \| 1 errors/);
  }
});

test("JSON reporter retains only the current watch run", () => {
  const output = memoryStream();
  const reporter = createTestReporter({ name: "json", stream: output.stream });
  for (const run of [1, 2]) {
    reporter.onEvent({ event: "run-start", run });
    reporter.onEvent({ event: "run-end", result: { ok: true } });
  }
  const documents = output
    .text()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    documents.map((doc) => doc.data.events.length),
    [2, 2],
  );
  assert.equal(documents[1].data.events[0].run, 2);
  assert.equal(reporter.events.length, 2);
});

test("JUnit reports remove XML-forbidden control characters", () => {
  const xml = junitReport({
    durationMs: 1,
    counts: { tests: 1, failed: 1, errors: 0 },
    files: [
      {
        file: "test/a.test.tfx",
        durationMs: 1,
        tests: [
          {
            name: "fails",
            status: "failed",
            durationMs: 1,
            error: {
              name: "AssertionError",
              message: "\u001b[31mfail & <bad>\u001b[0m",
            },
          },
        ],
      },
    ],
  });
  assert.equal(xml.includes("\u001b"), false);
  assert.match(xml, /fail &amp; &lt;bad&gt;/);
});

test("default reporter resolves relative test files for failure locations", () => {
  const output = memoryStream();
  const reporter = createTestReporter({
    name: "default",
    stream: output.stream,
    dir: path.resolve("/project"),
  });
  reporter.onEvent({
    event: "run-end",
    result: {
      startTime: new Date().toISOString(),
      durationMs: 1,
      files: [
        {
          file: "test/a.test.tfx",
          durationMs: 1,
          tests: [
            {
              name: "fails",
              status: "failed",
              durationMs: 1,
              error: { name: "Error", message: "bad" },
            },
          ],
        },
      ],
      diagnostics: [],
      counts: {
        files: 1,
        passedFiles: 0,
        failedFiles: 1,
        errorFiles: 0,
        tests: 1,
        passed: 0,
        failed: 1,
        errors: 0,
        pending: 0,
      },
    },
  });
  assert.match(output.text(), /❯ test\/a\.test\.tfx/);
});

test("JSON and JUnit reporters stay parseable when diagnostics occur", () => {
  const dir = tmpProject({ testSource: 'test "broken" { expect ; }\n' });
  try {
    const json = run(["test", "--json"], dir);
    assert.equal(json.status, TEST_EXIT.ERROR, json.stderr);
    const document = JSON.parse(json.stdout.trim());
    assert.equal(document.command, "test");
    assert.equal(document.ok, false);
    assert.ok(document.data.diagnostics.length > 0);
    assert.equal(document.data.counts.tests, 0);

    const junit = run(["test", "--reporter", "junit"], dir);
    assert.equal(junit.status, TEST_EXIT.ERROR, junit.stderr);
    const xml = junit.stdout.trim();
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), xml);
    assert.ok(xml.endsWith("</testsuites>"), xml);
    assert.doesNotMatch(xml, /×/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx test loads configured feature extensions in the headless VM", () => {
  const dir = tmpProject({
    source: `
        sprite "Player" {
            returning function counter() {
                thread let n = 1;
                $n += 1;
                return $n;
            }
        }
    `,
    testSource: 'test "tempvars" { expect Player.counter() == 2; }\n',
  });
  try {
    enableFeature({
      configPath: path.join(dir, "fx.yml"),
      configDir: dir,
      name: "temporaryvariables",
    });
    const result = run(["test", "--allow-project-extensions"], dir);
    assert.equal(result.status, TEST_EXIT.OK, result.stdout + result.stderr);
    assert.match(result.stdout, /1 passed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project extensions require an explicit test-run opt-in", async () => {
  const extension = `
class FxTestExtension {
  getInfo() {
    return { id: "fxtestext", name: "Fx Test", blocks: [] };
  }
}
Scratch.extensions.register(new FxTestExtension());
`;
  const dir = tmpProject({
    testSource: 'test "passes" { expect 1 == 1; }\n',
  });
  try {
    fs.writeFileSync(path.join(dir, "ext.js"), extension);
    const configPath = path.join(dir, "fx.yml");
    const writeConfig = (tests) =>
      fs.writeFileSync(
        configPath,
        `project:
  name: "Demo"
  extensions:
    - "./ext.js"
fx:
  tests:${tests}
`,
      );

    writeConfig(" true");
    const blocked = await runTests({ dir });
    assert.equal(blocked.exitCode, TEST_EXIT.ERROR);
    assert.equal(blocked.counts.tests, 0);
    assert.match(blocked.diagnostics[0].message, /allow-project-extensions/);

    // Project configuration alone cannot grant trust, even if it copies the
    // old setting name.
    writeConfig("\n    allowProjectExtensions: true");
    await assert.rejects(runTests({ dir }), /unknown fx.tests setting/);

    writeConfig(" true");
    const allowed = await runTests({ dir, allowProjectExtensions: true });
    assert.equal(allowed.exitCode, TEST_EXIT.OK, JSON.stringify(allowed));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("network access fails clearly while the test guard is active", async () => {
  const originalFetch = globalThis.fetch;
  const restore = installExternalIOGuard();
  try {
    await assert.rejects(
      fetch("https://example.invalid/fx-test"),
      /network access is blocked during fx test/i,
    );
    // Extension sources are data URLs, so the VM can still load them.
    const response = await fetch("data:text/plain,ok");
    assert.equal(await response.text(), "ok");
  } finally {
    restore();
  }
  assert.equal(globalThis.fetch, originalFetch);
});

test("network guard applies the same rules to URL objects and Request inputs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(input);
    return "allowed";
  };
  const extension = "https://example.invalid/extension.js";
  const restore = installExternalIOGuard([extension]);
  try {
    for (const url of [
      extension,
      "data:text/plain,ok",
      "blob:local",
      "file:///local",
    ]) {
      for (const input of [url, new URL(url), { url }])
        assert.equal(await fetch(input), "allowed");
    }
    for (const input of [
      new URL("https://example.invalid/blocked"),
      new Request("https://example.invalid/blocked"),
    ])
      await assert.rejects(fetch(input), /network access is blocked/);
    assert.equal(calls.length, 12);
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("failed project loading stops the VM and preserves the load error", async () => {
  const { VirtualMachine } = loadVmModules();
  const originalLoad = VirtualMachine.prototype.loadProject;
  const originalStop = VirtualMachine.prototype.stopAll;
  const originalLog = console.log;
  const error = new Error("load failed");
  let stopped = 0;
  VirtualMachine.prototype.loadProject = async () => {
    throw error;
  };
  VirtualMachine.prototype.stopAll = () => {
    stopped++;
    throw new Error("cleanup failed");
  };
  try {
    await assert.rejects(
      loadProject(Buffer.alloc(0)),
      (actual) => actual === error,
    );
    assert.equal(stopped, 1);
    assert.equal(console.log, originalLog);
  } finally {
    VirtualMachine.prototype.loadProject = originalLoad;
    VirtualMachine.prototype.stopAll = originalStop;
  }
});

test("a project load failure is an execution error, not a failed test", async () => {
  const dir = tmpProject({
    testSource: 'test "passes" { expect 1 == 1; }\n',
  });
  try {
    // A syntax error prevents the extension script from loading at all, so the
    // VM rejects while loading the built project.
    const result = await runTests({
      dir,
      allowProjectExtensions: true,
      catalog: {},
      extensionUrls: {
        broken: "data:text/javascript,this is not valid javascript",
      },
    });
    assert.equal(result.exitCode, TEST_EXIT.ERROR, JSON.stringify(result));
    assert.equal(result.counts.errors, 1);
    assert.equal(result.counts.failed, 0);
    const failed = result.files[0].tests[0];
    assert.equal(failed.status, "error");
    assert.match(failed.error.message, /could not load the project/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("asset text replacement updates data URIs and decoded text", () => {
  const storage = createStorage();
  const asset = storage.createAsset(
    storage.AssetType.ImageVector,
    "svg",
    new Uint8Array([1, 2, 3]),
  );
  asset.encodeTextData("hello");
  assert.equal(asset.decodeText(), "hello");
  assert.equal(
    asset.encodeDataURI(),
    `data:svg;base64,${Buffer.from("hello").toString("base64")}`,
  );
});

test("the headless VM denies project extensions until they are trusted", async () => {
  const url = "data:text/javascript,void 0";
  const blocked = createVm();
  assert.equal(
    await blocked.securityManager.canLoadExtensionFromProject(url),
    false,
  );
  assert.equal(await blocked.securityManager.getSandboxMode(url), "iframe");

  const trusted = createVm({ allowProjectExtensions: true });
  assert.equal(
    await trusted.securityManager.canLoadExtensionFromProject(url),
    true,
  );
  assert.equal(
    await trusted.securityManager.getSandboxMode(url),
    "unsandboxed",
  );
});

test("expect remains assignable and callable", () => {
  const body = parse(
    'test "names" { let expect = 0; expect = 5; expect += 1; expect(2); expect true; }',
  ).tests[0].body;
  assert.equal(body[1].type, "Assign");
  assert.equal(body[1].op, "=");
  assert.equal(body[2].type, "Assign");
  assert.equal(body[2].op, "+=");
  assert.equal(body[3].type, "BlockCall");
  assert.equal(body[4].type, "Expect");
});

test("parenthesized assertion operands remain expressions", () => {
  const body = parse(
    'test "grouped" { expect (a) == b; expect ((a + 1)) > b, "grouped"; expect (state.list("items").length) == 2; expect(foo(2)); expect("("); expect(2) { say("ok"); } }',
  ).tests[0].body;
  for (const statement of body.slice(0, 3)) {
    assert.equal(statement.type, "Expect");
    assert.equal(statement.value.type, "Binary");
  }
  assert.equal(body[1].message, "grouped");
  for (const statement of body.slice(3))
    assert.equal(statement.type, "BlockCall");
});

test("disabling tests preserves comments before the next key", () => {
  const dir = tmpProject();
  try {
    const configPath = path.join(dir, "fx.yml");
    fs.writeFileSync(
      configPath,
      "fx:\n  tests:\n    timeout: 500\n    # indented trailing comment\n  # next setting\n  partialSprites: false\n",
    );
    disableFeature({ configPath, configDir: dir, name: "tests" });
    assert.equal(
      fs.readFileSync(configPath, "utf8"),
      "fx:\n  tests: false\n    # indented trailing comment\n  # next setting\n  partialSprites: false\n",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx test preserves disabled configuration exit code and hint", () => {
  const dir = tmpProject({ tests: "false" });
  try {
    const result = run(["test"], dir);
    assert.equal(result.status, TEST_EXIT.ERROR, result.stderr);
    assert.match(result.stdout + result.stderr, /fx feature tests enable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx check excludes configured test patterns and preserves explicit files", () => {
  const dir = tmpProject({
    tests: '\n    pattern: "specs/**/*.tfx"',
    testSource: null,
  });
  try {
    fs.mkdirSync(path.join(dir, "specs"));
    fs.writeFileSync(
      path.join(dir, "specs", "custom.tfx"),
      'test "custom" { expect true; }',
    );
    const checked = run(["check"], dir);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 1 file/);
    assert.notEqual(run(["check", "specs/custom.tfx"], dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reset keeps list snapshots independent of later mutations", async () => {
  const dir = tmpProject({
    source:
      'sprite "Player" { list items = ["a"]; function addItem() { items.push("b"); } }',
    testSource:
      'test "reset list" { reset(); addItem(); expect state.list("items").length == 2; reset(); expect state.list("items").length == 1; }',
  });
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("returning helpers share state and isolate parameters and locals", async () => {
  const dir = tmpProject({
    testSource: `
    let shared = 0;
    let value = 7;
    returning function advance(value) {
      let local = 10;
      shared += 1;
      step(value);
      return local;
    }
    returning function restart() { reset(); return 1; }
    test "helper state" {
      expect advance(3) == 10;
      expect state.ticks() == 3;
      expect shared == 1;
      expect value == 7;
      expect advance(2) == 10;
      expect state.ticks() == 5;
      expect restart() == 1;
      expect state.ticks() == 0;
    }
  `,
  });
  try {
    const result = await runTests({ dir });
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("simulated ticks advance project timers and waits", async () => {
  const dir = tmpProject({
    source: `sprite "Player" {
      let elapsed = 0;
      when greenFlag { control.wait(1); elapsed = sensing.timer(); }
    }`,
    testSource:
      'test "clock" { start(); step(40); expect state.variable("elapsed") >= 1; expect state.variable("elapsed") < 1.4; }',
  });
  try {
    const started = performance.now();
    const result = await runTests({ dir, ticksPerSecond: 30, timeout: 5000 });
    const wallClockMs = performance.now() - started;
    assert.equal(result.exitCode, TEST_EXIT.OK, JSON.stringify(result));
    // More than a second of project time passed without sleeping in real time;
    // only the timeout uses the wall clock.
    assert.ok(wallClockMs < 2000, `test run took ${wallClockMs}ms`);
    assert.ok(result.files[0].tests[0].ticks > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watch exits on SIGINT while waiting without a file change", async () => {
  const dir = tmpProject();
  const child = spawn(process.execPath, [bin, "test", "--watch"], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
  });
  try {
    const result = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("watch did not exit: " + output));
      }, 15000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Watching for changes")) child.kill("SIGINT");
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    assert.deepEqual(result, { code: TEST_EXIT.INTERRUPTED, signal: null });
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
