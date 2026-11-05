/**
 * CLI entrypoint: commander setup, global options, and top-level error
 * handling.
 */

import process from "node:process";
import { Command, CommanderError } from "commander";
import { brandText } from "../brand.js";
import { loadProduct } from "../product.js";
import { registerCommands } from "./commands/index.js";
import {
  CliError,
  EXIT,
  UsageError,
  errorToJson,
  formatError,
} from "./errors.js";
import { createReporter } from "./reporter.js";
import { createTheme } from "./theme.js";

const USAGE_CODES = new Set([
  "commander.unknownCommand",
  "commander.unknownOption",
  "commander.missingArgument",
  "commander.optionMissingArgument",
  "commander.invalidArgument",
  "commander.excessArguments",
]);

function resolveColor(options = {}) {
  if (options.color === false || options.color === "never") return "never";
  if (options.color === "always") return "always";
  return "auto";
}

/** Read the global flags needed before commander has parsed successfully. */
function scanGlobalFlags(argv) {
  const result = {
    json: false,
    quiet: false,
    verbose: false,
    color: "auto",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") result.json = true;
    else if (token === "-q" || token === "--quiet") result.quiet = true;
    else if (token === "-v" || token === "--verbose") result.verbose = true;
    else if (token === "--no-color") result.color = "never";
    else if (token === "--color") result.color = argv[++i] ?? "auto";
    else if (token.startsWith("--color="))
      result.color = token.slice("--color=".length);
  }
  return result;
}

function commandFromArgv(argv, program) {
  const names = new Set();
  for (const command of program.commands)
    for (const name of [command.name(), ...command.aliases()]) names.add(name);
  for (const token of argv) if (names.has(token)) return token;
  return null;
}

function styleUsage(text, theme) {
  return text
    .split(" ")
    .map((word) => {
      if (word === "[options]") return theme.option(word);
      if (word === "[command]") return theme.command(word);
      if (word.startsWith("[") || word.startsWith("<"))
        return theme.argument(word);
      return theme.command(word);
    })
    .join(" ");
}

function styleOptionTerm(text, theme) {
  return text
    .split(" ")
    .map((word) =>
      word.startsWith("<") || word.startsWith("[")
        ? theme.argument(word)
        : theme.option(word),
    )
    .join(" ");
}

function styleSubcommandTerm(text, theme) {
  return text
    .split(" ")
    .map((word) => {
      if (word === "[options]") return theme.option(word);
      if (word.startsWith("[") || word.startsWith("<"))
        return theme.argument(word);
      return theme.command(word);
    })
    .join(" ");
}

function createProgram(product, theme, color) {
  const program = new Command();
  program
    .name(product.command)
    .description(product.tagline)
    .version(
      `${product.name} ${product.version}`,
      "-V, --version",
      "Print the version",
    )
    .helpOption("-h, --help", "Show help")
    .helpCommand("help [command]", "Show help for a command")
    .showSuggestionAfterError(true)
    .configureHelp({
      sortCommands: false,
      sortOptions: false,
      showGlobalOptions: true,
      styleTitle: (text) => theme.heading(text),
      styleUsage: (text) => styleUsage(text, theme),
      styleCommandText: (text) => theme.command(text),
      styleSubcommandText: (text) => theme.command(text),
      styleOptionText: (text) => theme.option(text),
      styleArgumentText: (text) => theme.argument(text),
      styleCommandDescription: (text) => theme.muted(text),
      styleOptionDescription: (text) => theme.muted(text),
      styleSubcommandDescription: (text) => theme.muted(text),
      styleArgumentDescription: (text) => theme.muted(text),
      styleOptionTerm: (text) => styleOptionTerm(text, theme),
      styleSubcommandTerm: (text) => styleSubcommandTerm(text, theme),
      styleArgumentTerm: (text) => theme.argument(text),
    })
    .optionsGroup("Global Options:")
    .option("-v, --verbose", "Show timings, stack traces, and extra detail")
    .option("--json", "Emit machine-readable JSON")
    .option("-q, --quiet", "Suppress success and informational output")
    .option("--color <mode>", "Color output: auto, always, or never", "auto")
    .option("--no-color", "Disable color output")
    .option("--cwd <dir>", "Run as if started in <dir>")
    .option("--config <file>", "Use a specific config file")
    .option("--no-config", "Ignore the project config file")
    .option("--no-input", "Never prompt for input")
    .option("-y, --yes", "Accept defaults and confirm destructive actions")
    .option(
      "--no-upgrade-prompt",
      "Do not offer to migrate project.extensions",
    );

  program.addHelpText(
    "before",
    `\n  ${brandText(product.name, process.stdout, {
      force: color === "always",
    })} ${theme.muted(product.version)}\n  ${theme.muted(product.tagline)}\n`,
  );
  program.addHelpText(
    "after",
    `\n  ${theme.accent("↳")} Run ${theme.command(
      `${product.command} <command> --help`,
    )} for command details.\n`,
  );

  return program;
}

/**
 * Run the CLI and return an exit code instead of terminating the process.
 *
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function run(argv = process.argv.slice(2)) {
  const product = loadProduct();
  const raw = scanGlobalFlags(argv);
  const color = resolveColor(raw);
  const theme = createTheme({ product, color, stream: process.stdout });
  const reporter = createReporter({
    product,
    json: raw.json,
    quiet: raw.quiet,
    verbose: raw.verbose,
    color,
  });
  const state = { exitCode: EXIT.OK, command: null };
  const program = createProgram(product, theme, color);
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
    getOutHasColors: () => theme.enabled,
    getErrHasColors: () => theme.enabled,
    // Keep commander's usage text out of the stream; run() renders one
    // consistent diagnostic (or JSON document) below.
    outputError: () => {},
  });

  registerCommands(program, { state, product });
  // With no command, print help to stdout instead of commander's stderr usage.
  program.action(() => program.outputHelp());

  try {
    await program.parseAsync(argv, { from: "user" });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.help" ||
        error.code === "commander.version"
      )
        return EXIT.OK;

      const usage = new UsageError(error.message.replace(/^error:\s*/, ""), {
        code: USAGE_CODES.has(error.code) ? "USAGE_ERROR" : "COMMANDER_ERROR",
        hint: `run "${product.command} help" for usage`,
      });
      usage.command = state.command ?? commandFromArgv(argv, program);
      usage.warnings = [];
      return reportError(usage, reporter);
    }

    if (error && typeof error === "object") {
      error.warnings ??= [];
      error.command ??= state.command ?? commandFromArgv(argv, program);
    }
    return reportError(error, reporter);
  }
}

function reportError(error, reporter) {
  const exitCode = error instanceof CliError ? error.exitCode : EXIT.FAILURE;
  const command = error?.command ?? null;

  if (reporter.json) {
    reporter.document({
      schemaVersion: 1,
      command,
      ok: false,
      warnings: error?.warnings ?? [],
      error: errorToJson(error),
    });
    return exitCode;
  }

  if (error instanceof CliError && error.silent) return exitCode;

  reporter.error(formatError(error, { verbose: reporter.verbose }));
  if (error instanceof CliError && error.hint) reporter.hint(error.hint);
  return exitCode;
}
