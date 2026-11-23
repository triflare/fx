/**
 * Run runner.
 *
 * `fx run` reuses the headless PenguinMod VM from the testing subsystem, but
 * its job is to execute project code rather than to assert on it. The run file
 * is merged into an in-memory build so the compiler checks the entry point and
 * every block it calls; the VM then starts `main` and steps until the scripts
 * it started have finished.
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "../build.js";
import { loadProject } from "../vm.js";
import { loadConfigFrom, DEFAULT_RUN } from "../config.js";
import { discoverSources } from "../project.js";
import { DEFAULT_TEST_PATTERN } from "../test/discover.js";
import { discoverRuns } from "./discover.js";
import { loadProjectCatalog } from "../project-catalog.js";
import { productVersion } from "../brand.js";
import { installExternalIOGuard } from "../test/runner.js";
import { parseRuns } from "./parse.js";

/** Exit codes promised by `fx run`. */
export const RUN_EXIT = {
  OK: 0,
  FAILED: 1,
  ERROR: 2,
  INTERRUPTED: 3,
  USAGE: 4,
};

/** A configuration, parsing or execution problem with the run itself. */
export class RunError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RunError";
    this.exitCode = options.exitCode ?? RUN_EXIT.ERROR;
    this.hint = options.hint;
    this.file = options.file ?? null;
    this.line = options.line ?? null;
    this.column = options.column ?? null;
  }
}

class RunTimeoutError extends Error {
  constructor(timeout) {
    super(`Run timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

/** Read one line from standard input synchronously, for `run.prompt`. */
export function readStdinLine() {
  const buffer = Buffer.alloc(1);
  const bytes = [];
  for (;;) {
    let read;
    try {
      read = fs.readSync(0, buffer, 0, 1, null);
    } catch (error) {
      if (error.code === "EAGAIN") {
        Atomics.wait(sleepBuffer, 0, 0, 10);
        continue;
      }
      if (error.code === "EOF" || error.code === "EBADF") break;
      throw error;
    }
    if (read === 0) break;
    if (buffer[0] === 0x0a) break;
    if (buffer[0] !== 0x0d) bytes.push(buffer[0]);
  }
  return Buffer.from(bytes).toString("utf8");
}

function defaultPrompt(message) {
  if (message) process.stderr.write(`${message} `);
  return readStdinLine();
}

/** Scratch-style truthiness for a compiled boolean input. */
function truthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim();
  return text !== "" && text !== "0" && !/^false$/i.test(text);
}

/**
 * Tell the VM's IR compiler about the run opcodes. Without this, the compiler
 * rejects extension-shaped opcodes even though their primitives are installed.
 */
function registerRunBlockInfo(runtime) {
  if (!Array.isArray(runtime._blockInfo)) return;
  const args = (names) =>
    Object.fromEntries(names.map((name) => [name, { compilerInfo: {} }]));
  runtime._blockInfo.unshift({
    id: "fxRun",
    name: "Run",
    blocks: [
      {
        info: {
          opcode: "print",
          blockType: "command",
          arguments: args(["TEXT"]),
        },
      },
      {
        info: {
          opcode: "warn",
          blockType: "command",
          arguments: args(["TEXT"]),
        },
      },
      {
        info: {
          opcode: "error",
          blockType: "command",
          arguments: args(["TEXT"]),
        },
      },
      {
        info: {
          opcode: "assert",
          blockType: "command",
          arguments: args(["CONDITION", "MESSAGE"]),
        },
      },
      {
        info: {
          opcode: "prompt",
          blockType: "reporter",
          arguments: args(["TEXT"]),
        },
      },
    ],
  });
}

/** Deterministic pseudo-random source for a run. */
function mulberry32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Input block id for the shapes a compiled and a loaded project use. */
function inputBlockId(input) {
  if (Array.isArray(input)) return input[1] ?? null;
  if (input && typeof input === "object")
    return input.block ?? input.shadow ?? null;
  return null;
}

/** Find the compiled `main` procedure on the stage, if it exists. */
function findMainProcedure(target) {
  const blocks = target?.blocks?._blocks ?? {};
  for (const block of Object.values(blocks)) {
    if (
      block.opcode !== "procedures_definition" &&
      block.opcode !== "procedures_definition_return"
    )
      continue;
    const protoId = inputBlockId(block.inputs?.custom_block);
    const proto = typeof protoId === "string" ? blocks[protoId] : null;
    const mutation = proto?.mutation;
    if (String(mutation?.proccode ?? "") !== "main") continue;
    return {
      proccode: "main",
      argumentids: "[]",
      returns:
        block.opcode === "procedures_definition_return" ||
        mutation.returns === "true" ||
        mutation.returns === true,
    };
  }
  return null;
}

/** Add a synthetic top-level `procedures_call` that starts the entry point. */
function injectEntryCall(target, procedure, stamp) {
  const callId = `${stamp}_main`;
  target.blocks._blocks[callId] = {
    id: callId,
    opcode: "procedures_call",
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
    mutation: {
      tagName: "mutation",
      children: [],
      proccode: procedure.proccode,
      argumentids: procedure.argumentids,
      warp: "false",
      ...(procedure.returns ? { returns: "true" } : {}),
    },
  };
  return callId;
}

/** Resolve files for a run, filtering them through the configured glob. */
function resolveRunFiles({ root, files, cwd, pattern }) {
  if (files?.length)
    return files.map((file) => {
      const absolute = path.resolve(cwd, file);
      return {
        file: absolute,
        relative: path.relative(root, absolute).split(path.sep).join("/"),
      };
    });
  return discoverRuns({ dir: root, pattern });
}

/** Build the project plus the run entry files in memory. */
function buildRunProject({ root, loaded, runFiles, catalog, extensionUrls }) {
  const runPaths = new Set(runFiles.map((entry) => entry.file));
  const projectSources = discoverSources(root, {
    testPattern: loaded.fx?.tests
      ? loaded.fx.tests.pattern
      : DEFAULT_TEST_PATTERN,
    runPattern: loaded.fx?.run?.pattern,
  })
    .filter((file) => !runPaths.has(file))
    .map((file) => ({ file, source: fs.readFileSync(file, "utf8") }));

  const entries = runFiles.map((entry) => ({
    file: entry.file,
    source: fs.readFileSync(entry.file, "utf8"),
  }));

  return build({
    sources: [...projectSources, ...entries],
    dir: root,
    projectConfig: loaded.project,
    fxConfig: loaded.fx,
    catalog,
    extensionUrls,
    runMode: true,
    useConfigFile: false,
  });
}

/**
 * Execute a run file's `main` function in a fresh headless VM.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runInVm({
  root,
  runFiles,
  built,
  config,
  seed,
  onPrint = () => {},
  onOutput = () => {},
  prompt = defaultPrompt,
}) {
  const started = performance.now();
  const startDate = new Date();
  let vm;
  try {
    vm = await loadProject(built.sb3, {
      allowProjectExtensions: config.allowProjectExtensions,
    });
  } catch (error) {
    throw new RunError(
      `could not load the project: ${error?.message ?? String(error)}`,
      { cause: error },
    );
  }

  const runtime = vm.runtime;
  runtime.currentStepTime = 1000 / config.ticksPerSecond;
  runtime.updateCurrentMSecs = () => {};

  const prints = [];
  const errors = [];
  const warnings = [];
  const prompts = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalRandom = Math.random;
  const compileErrorEvent =
    runtime.constructor?.COMPILE_ERROR ?? "COMPILE_ERROR";
  const onCompileError = (_target, error) =>
    errors.push(error?.message ?? String(error));
  runtime.on?.(compileErrorEvent, onCompileError);

  console.error = (...args) => errors.push(args.map(String).join(" "));
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  Math.random = mulberry32(seed);
  let explicitFailure = null;
  const emit = (type, text) => onOutput({ type, text });

  // The compiler only emits `fxRun_*` opcodes for the run build. Implement
  // them directly on the runtime so running needs no extension file, catalog,
  // or project trust decision.
  Object.assign(runtime._primitives, {
    fxRun_print(args) {
      const line = String(args?.TEXT ?? "");
      prints.push(line);
      onPrint(line);
      emit("print", line);
    },
    fxRun_warn(args) {
      const line = String(args?.TEXT ?? "");
      warnings.push(line);
      emit("warn", line);
    },
    fxRun_error(args) {
      const line = String(args?.TEXT ?? "");
      errors.push(line);
      explicitFailure ??= { name: "RunError", message: line };
      emit("error", line);
    },
    fxRun_assert(args) {
      if (truthy(args?.CONDITION)) return;
      const line =
        String(args?.MESSAGE ?? "").trim() || "assertion failed during fx run";
      errors.push(line);
      explicitFailure ??= { name: "AssertionError", message: line };
      emit("error", line);
    },
    fxRun_prompt(args) {
      const message = String(args?.TEXT ?? "");
      emit("prompt", message);
      const answer = String(prompt(message) ?? "");
      prompts.push({ message, answer });
      return answer;
    },
  });
  registerRunBlockInfo(runtime);

  const stage = runtime.getTargetForStage?.();
  const procedure = findMainProcedure(stage);
  let callId = null;
  let ticks = 0;
  let failure = null;
  let failureExit = RUN_EXIT.FAILED;

  try {
    if (!procedure)
      throw new RunError(
        "The project does not expose the run entry point `main`",
        { exitCode: RUN_EXIT.ERROR },
      );
    if (typeof runtime._pushThread !== "function")
      throw new RunError(
        "This PenguinMod VM build cannot run project blocks by name",
        { exitCode: RUN_EXIT.ERROR },
      );

    const stamp = `fxrun_${Date.now().toString(36)}`;
    callId = injectEntryCall(stage, procedure, stamp);
    const thread = runtime._pushThread(callId, stage);
    if (!thread)
      throw new RunError("Could not start the run entry point in the VM");

    // Keep stepping until every script started by `main` has finished. A
    // broadcast or a cloned script may outlive the entry-point thread itself.
    const deadline = started + config.timeout;
    while (runtime.threads.length > 0) {
      if (performance.now() > deadline)
        throw new RunTimeoutError(config.timeout);
      try {
        runtime.currentMSecs += 1000 / config.ticksPerSecond;
        runtime._step();
      } catch (error) {
        errors.push(error?.message ?? String(error));
        if (config.failOnRuntimeError) throw error;
      }
      ticks += 1;
      if (explicitFailure) break;
    }

    if (explicitFailure) {
      failure = explicitFailure;
      failureExit = RUN_EXIT.FAILED;
    } else if (config.failOnRuntimeError && errors.length > 0)
      throw new Error(`runtime error: ${errors[0]}`);
  } catch (error) {
    failure = {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    };
    failureExit = error?.exitCode ?? RUN_EXIT.FAILED;
  } finally {
    runtime.off?.(compileErrorEvent, onCompileError);
    console.error = originalError;
    console.warn = originalWarn;
    Math.random = originalRandom;
    if (callId && stage?.blocks?._blocks) delete stage.blocks._blocks[callId];
    try {
      vm.stopAll();
    } catch {
      // A VM that failed to load has nothing to stop.
    }
  }

  return {
    dir: root,
    version: productVersion(),
    startTime: startDate.toISOString(),
    durationMs: Math.round(performance.now() - started),
    seed,
    ticks,
    files: runFiles.map((entry) => ({
      file: entry.relative,
      entry: "main",
      status: failure ? "failed" : "passed",
      error: failure,
    })),
    prints,
    errors,
    warnings,
    prompts,
    error: failure,
    ok: !failure,
    exitCode: failure ? failureExit : RUN_EXIT.OK,
  };
}

/**
 * Run a project's entry point headlessly.
 *
 * @param {object} [options]
 * @param {string} [options.dir] project directory
 * @param {string[]} [options.files] explicit run files, relative to `cwd`
 * @param {string} [options.cwd] base for explicit files
 * @param {object} [options.loaded] preloaded project config
 * @param {Record<string, object>} [options.catalog]
 * @param {Record<string, string>} [options.extensionUrls]
 * @param {number} [options.seed]
 * @param {number} [options.timeout]
 * @param {number} [options.ticksPerSecond]
 * @param {boolean} [options.failOnRuntimeError]
 * @param {boolean} [options.allowProjectExtensions] trust this project's extensions
 * @param {boolean} [options.allowExternalIO] allow network access during the run
 * @param {(line: string) => void} [options.onPrint]
 * @param {(output: {type: "print"|"warn"|"error"|"prompt", text: string}) => void} [options.onOutput]
 * @param {(message: string) => string} [options.prompt] read a line for `run.prompt`
 * @returns {Promise<object>}
 */
export async function runRuns({
  dir = process.cwd(),
  files,
  cwd = process.cwd(),
  loaded: provided,
  catalog,
  extensionUrls,
  seed,
  timeout,
  ticksPerSecond,
  failOnRuntimeError,
  allowProjectExtensions = false,
  allowExternalIO = false,
  onPrint = () => {},
  onOutput = () => {},
  prompt = defaultPrompt,
} = {}) {
  const root = path.resolve(dir);
  const loaded = provided ?? loadConfigFrom(root);
  const configDir = loaded.path ? path.dirname(loaded.path) : root;
  const settings = loaded.fx?.run;

  if (!settings)
    throw new RunError("Running is disabled in this project.", {
      exitCode: RUN_EXIT.ERROR,
      hint: 'run "fx feature run enable" to turn running on',
    });

  const config = {
    ...DEFAULT_RUN,
    ...settings,
    seed: seed ?? settings.seed ?? DEFAULT_RUN.seed,
    timeout: timeout ?? settings.timeout ?? DEFAULT_RUN.timeout,
    ticksPerSecond:
      ticksPerSecond ?? settings.ticksPerSecond ?? DEFAULT_RUN.ticksPerSecond,
    failOnRuntimeError:
      failOnRuntimeError ??
      settings.failOnRuntimeError ??
      DEFAULT_RUN.failOnRuntimeError,
    allowProjectExtensions: Boolean(allowProjectExtensions),
    allowExternalIO: Boolean(allowExternalIO),
  };

  const discovered = resolveRunFiles({
    root,
    files,
    cwd,
    pattern: settings.pattern,
  });
  if (discovered.length === 0)
    throw new RunError(
      `No run files matched ${JSON.stringify(settings.pattern)} under ${root}`,
      { exitCode: RUN_EXIT.ERROR },
    );

  let parsedRuns;
  try {
    parsedRuns = parseRuns(
      discovered.map((entry) => ({
        file: entry.relative,
        source: fs.readFileSync(entry.file, "utf8"),
      })),
    );
  } catch (error) {
    throw new RunError(error.message, {
      cause: error,
      file: error.file ?? null,
      line: error.line ?? null,
      column: error.column ?? null,
    });
  }
  const runFiles = parsedRuns.map((parsed, index) => ({
    ...parsed,
    absolute: discovered[index].file,
    relative: discovered[index].relative,
  }));

  let extensions = { catalog, extensionUrls, warnings: [] };
  if (!catalog) extensions = await loadProjectCatalog({ configDir, loaded });

  // A project extension is arbitrary JavaScript that runs with Node process
  // access in the VM. Deny it without an explicit opt-in, just like `fx test`.
  // Run blocks need no extension, so nothing is exempt from this check.
  if (!config.allowProjectExtensions) {
    const blocked = Object.keys(extensions.extensionUrls ?? {});
    if (blocked.length > 0)
      throw new RunError(
        `Project extensions are blocked during fx run: ${blocked
          .sort()
          .map((id) => JSON.stringify(id))
          .join(", ")}. ` +
          'Pass "--allow-project-extensions" to trust and load this project\'s extensions for this run.',
        { exitCode: RUN_EXIT.ERROR },
      );
  }

  let built;
  try {
    built = buildRunProject({
      root,
      loaded,
      runFiles: runFiles.map((entry) => ({
        file: entry.absolute,
        relative: entry.relative,
      })),
      catalog: extensions.catalog,
      extensionUrls: extensions.extensionUrls,
    });
  } catch (error) {
    throw new RunError(error.message, {
      cause: error,
      file: error.file ?? null,
      line: error.line ?? null,
      column: error.column ?? null,
    });
  }

  const restoreExternalIO = config.allowExternalIO
    ? () => {}
    : installExternalIOGuard(Object.values(extensions.extensionUrls ?? {}), {
        label: "fx run",
      });
  try {
    const result = await runInVm({
      root,
      runFiles: runFiles.map((entry) => ({
        file: entry.absolute,
        relative: entry.relative,
      })),
      built,
      config,
      seed: config.seed,
      onPrint,
      onOutput,
      prompt,
    });
    result.warnings.unshift(...extensions.warnings);
    return result;
  } finally {
    restoreExternalIO();
  }
}
