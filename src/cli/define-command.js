/**
 * Shared command registration and result handling.
 */

import path from "node:path";
import { Command } from "commander";
import { createPrompts } from "./prompts.js";
import { createReporter } from "./reporter.js";

function resolveColor(options) {
  if (options.color === false || options.color === "never") return "never";
  if (options.color === "always") return "always";
  return "auto";
}

/** Build the per-command context from global and command options. */
export function createContext({ command, product }) {
  const options = command.optsWithGlobals();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const json = Boolean(options.json);
  const noInput = options.input === false || json;
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const reporter = createReporter({
    product,
    json,
    quiet: Boolean(options.quiet),
    verbose: Boolean(options.verbose),
    color: resolveColor(options),
  });
  const prompts = createPrompts({
    reporter,
    product,
    tty,
    noInput,
    json,
  });

  return {
    command,
    product,
    options,
    args: command.processedArgs,
    cwd,
    json,
    yes: Boolean(options.yes),
    reporter,
    prompts,
  };
}

/** Mark a command result with an explicit exit status. */
export function outcome({ data = null, exitCode = 0, error = null } = {}) {
  return {
    __outcome: true,
    ok: exitCode === 0 && !error,
    exitCode,
    data,
    error,
  };
}

function normalizeOutcome(result) {
  if (result && result.__outcome) return result;
  return { ok: true, exitCode: 0, data: result ?? null, error: null };
}

function configure(command, spec) {
  command.description(spec.summary ?? spec.description ?? "");
  if (spec.aliases?.length) command.aliases(spec.aliases);
  if (spec.group) command.helpGroup(spec.group);
  for (const argument of spec.arguments ?? []) command.argument(argument);
  for (const option of spec.options ?? []) {
    if (option.defaultValue === undefined)
      command.option(option.flags, option.description);
    else command.option(option.flags, option.description, option.defaultValue);
  }
  const details = [];
  if (spec.description && spec.description !== spec.summary)
    details.push(spec.description);
  if (spec.examples?.length)
    details.push(
      `Examples:\n${spec.examples.map((example) => `  ${example}`).join("\n")}`,
    );
  if (details.length)
    command.addHelpText("after", `\n${details.join("\n\n")}\n`);
  return command;
}

/** Full command path, such as "vendor list", for diagnostics and JSON. */
function commandPath(command) {
  const parts = [];
  for (let current = command; current?.parent; current = current.parent)
    parts.unshift(current.name());
  return parts.join(" ");
}

/**
 * Register one command (or subcommand) with shared error, JSON, and output
 * handling.
 *
 * @param {Command} parent
 * @param {object} spec
 * @param {{state: {exitCode: number, command?: string}, product: object}} options
 */
export function defineCommand(parent, spec, { state, product }) {
  const command = configure(new Command(spec.name), spec);
  command.copyInheritedSettings(parent);

  command.action(async function action() {
    const command = this;
    const name = commandPath(command);
    const context = createContext({ command, product });
    state.command = name;
    try {
      const result = await spec.run(context);
      const normalized = normalizeOutcome(result);
      if (context.options.json && !spec.jsonEvents) {
        const payload = {
          schemaVersion: 1,
          command: name,
          ok: normalized.ok,
          warnings: context.reporter.warnings,
        };
        if (normalized.error) payload.error = normalized.error;
        else payload.data = normalized.data;
        context.reporter.document(payload);
      }
      state.exitCode = normalized.exitCode;
    } catch (error) {
      if (error && typeof error === "object") {
        error.command ??= name;
        error.warnings ??= context.reporter.warnings;
      }
      throw error;
    }
  });

  parent.addCommand(command, { hidden: Boolean(spec.hidden) });
  return command;
}
