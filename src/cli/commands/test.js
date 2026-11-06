import fs from "node:fs";
import { loadProjectState } from "../context.js";
import { CliError } from "../errors.js";
import { outcome } from "../define-command.js";
import { createTestReporter, REPORTER_NAMES } from "../../test/reporters.js";
import { runTests, TestError, TEST_EXIT } from "../../test/runner.js";

const WATCH_IGNORED = /(^|\/)(node_modules|build|dist|\.git|doc_build)(\/|$)/;

/** Resolve a `--reporter` value, mapping the global `--json` flag onto it. */
function reporterName(options) {
  const name = String(options.reporter ?? "default");
  if (options.json && name === "default") return "json";
  if (!REPORTER_NAMES.includes(name))
    throw new CliError(`Unknown reporter ${JSON.stringify(name)}.`, {
      code: "TEST_USAGE",
      exitCode: TEST_EXIT.USAGE,
      hint: `use one of: ${REPORTER_NAMES.join(", ")}`,
    });
  return name;
}

/** Parse a positive numeric option, reporting usage errors with its label. */
function validateNumber(value, label) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new CliError(`${label} must be a positive number`, {
      code: "TEST_USAGE",
      exitCode: TEST_EXIT.USAGE,
    });
  return number;
}

/** Wait for the next source or config change. */
function nextChange(dir, signal) {
  return new Promise((resolve, reject) => {
    let watcher;
    let timer = null;
    const done = () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      signal.removeEventListener("abort", done);
      resolve();
    };
    if (signal.aborted) return done();
    signal.addEventListener("abort", done, { once: true });
    try {
      watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const name = String(filename).split("\\").join("/");
        if (WATCH_IGNORED.test(name)) return;
        if (!/\.(tfx|ya?ml)$/i.test(name)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(done, 80);
      });
    } catch (error) {
      signal.removeEventListener("abort", done);
      reject(error);
    }
  });
}

export const testCommand = {
  name: "test",
  group: "Core Commands:",
  summary: "Run project tests in a headless PenguinMod VM",
  description: `Discover test files (test/**/*.test.tfx by default), build the project
once, and run every test in a fresh VM. Testing is a language feature: enable
it with "fx feature tests enable".`,
  arguments: ["[files...]"],
  options: [
    {
      flags: "-t, --filter <text>",
      description: "Only run tests whose name or file contains <text>",
    },
    { flags: "-w, --watch", description: "Re-run when sources change" },
    { flags: "--run", description: "Run once and exit (the default)" },
    {
      flags: "--reporter <name>",
      description: `Output format: ${REPORTER_NAMES.join(", ")}`,
      defaultValue: "default",
    },
    { flags: "--seed <number>", description: "Seed the random generator" },
    {
      flags: "--timeout <ms>",
      description: "Per-test timeout in milliseconds",
    },
  ],
  examples: [
    "fx test",
    "fx test test/score.test.tfx",
    "fx test --filter score --reporter verbose",
    "fx test --reporter junit",
  ],
  jsonEvents: true,
  async run({ args, options, cwd, reporter, prompts }) {
    // Commander hands a variadic argument back as one array.
    const files = (Array.isArray(args[0]) ? args[0] : args).filter(Boolean);
    const name = reporterName(options);
    const color =
      options.color === "always" ||
      (options.color !== "never" &&
        options.color !== false &&
        Boolean(process.stdout.isTTY) &&
        !process.env.NO_COLOR);
    const testReporter = createTestReporter({
      name,
      stream: process.stdout,
      color,
      tty: Boolean(process.stdout.isTTY),
      dir: cwd,
    });

    const runOnce = async () => {
      const state = await loadProjectState({
        input: undefined,
        cwd,
        options,
        reporter,
        prompts,
      });
      return runTests({
        dir: state.configDir,
        files,
        cwd,
        filter: options.filter ?? "",
        loaded: state.loaded,
        catalog: state.catalog,
        extensionUrls: state.extensionUrls,
        seed: validateNumber(options.seed, "--seed"),
        timeout: validateNumber(options.timeout, "--timeout"),
        onEvent: testReporter.onEvent,
      });
    };

    if (!options.watch) {
      try {
        const result = await runOnce();
        return outcome({ data: result, exitCode: result.exitCode });
      } catch (error) {
        if (error instanceof TestError)
          throw new CliError(error.message, {
            code: "TEST_ERROR",
            exitCode: error.exitCode,
            hint: error.hint,
            cause: error,
          });
        throw error;
      }
    }

    const controller = new AbortController();
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      controller.abort();
    };
    process.once("SIGINT", onInterrupt);
    try {
      for (;;) {
        const result = await runOnce();
        if (interrupted)
          return outcome({ data: result, exitCode: TEST_EXIT.INTERRUPTED });
        reporter.info("Watching for changes... (Ctrl+C to stop)");
        await nextChange(result.dir, controller.signal);
        if (interrupted)
          return outcome({ data: result, exitCode: TEST_EXIT.INTERRUPTED });
      }
    } finally {
      controller.abort();
      process.off("SIGINT", onInterrupt);
    }
  },
};
