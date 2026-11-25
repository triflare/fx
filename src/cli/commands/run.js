import { loadProjectState } from "../context.js";
import { CliError } from "../errors.js";
import { outcome } from "../define-command.js";
import { runRuns, RunError, RUN_EXIT } from "../../run/runner.js";

/** Parse a positive numeric option, reporting usage errors with its label. */
function validateNumber(value, label) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new CliError(`${label} must be a positive number`, {
      code: "RUN_USAGE",
      exitCode: RUN_EXIT.USAGE,
    });
  return number;
}

export const runCommand = {
  name: "run",
  group: "Core Commands:",
  summary: "Run a project entry point in a headless PenguinMod VM",
  description: `Compile the project together with its run files, then execute the
\`main\` function from the run file. Running is a language feature: enable it
with "fx feature run enable".`,
  arguments: ["[files...]"],
  options: [
    {
      flags: "--timeout <ms>",
      description: "Wall-clock budget for the whole run in milliseconds",
    },
    { flags: "--seed <number>", description: "Seed the random generator" },
    {
      flags: "--ticks-per-second <number>",
      description: "Frames per second of simulated project time",
    },
    {
      flags: "--allow-project-extensions",
      description: "Trust and load this project's extensions for this run",
    },
    {
      flags: "--allow-external-io",
      description: "Allow network access (fetch and WebSocket) during a run",
    },
  ],
  examples: [
    "fx run",
    "fx run run/main.run.tfx",
    "fx run --timeout 10000",
    "fx run --allow-project-extensions",
  ],
  async run({ args, options, cwd, reporter, prompts }) {
    // Commander hands a variadic argument back as one array.
    const files = (Array.isArray(args[0]) ? args[0] : args).filter(Boolean);
    const state = await loadProjectState({
      input: undefined,
      cwd,
      options,
      reporter,
      prompts,
    });

    let result;
    try {
      result = await runRuns({
        dir: state.configDir,
        files,
        cwd,
        loaded: state.loaded,
        catalog: state.catalog,
        extensionUrls: state.extensionUrls,
        seed: validateNumber(options.seed, "--seed"),
        timeout: validateNumber(options.timeout, "--timeout"),
        ticksPerSecond: validateNumber(
          options.ticksPerSecond,
          "--ticks-per-second",
        ),
        allowProjectExtensions: Boolean(options.allowProjectExtensions),
        allowExternalIO: Boolean(options.allowExternalIO),
        onOutput: ({ type, text }) => {
          if (reporter.json) return;
          if (type === "print") reporter.raw(`${text}\n`);
          else if (type === "warn") reporter.warn(text);
          // Errors are reported by the CliError thrown after the run.
        },
      });
    } catch (error) {
      if (error instanceof RunError)
        throw new CliError(error.message, {
          code: "RUN_ERROR",
          exitCode: error.exitCode,
          hint: error.hint,
          cause: error,
        });
      throw error;
    }

    if (!result.ok)
      throw new CliError(
        `${result.error?.name ?? "Error"}: ${result.error?.message ?? "run failed"}`,
        {
          code: "RUN_FAILED",
          exitCode: result.exitCode,
          cause: result.error,
        },
      );

    return outcome({ data: result, exitCode: result.exitCode });
  },
};
