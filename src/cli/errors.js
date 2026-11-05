/**
 * CLI-specific errors and exit-code mapping.
 *
 * Command handlers throw these instead of writing to a stream and calling
 * `process.exit`, which keeps the CLI testable and lets `run()` decide between
 * human and JSON diagnostics.
 */

import { FxError } from "../errors.js";

/** Exit codes shared by every command. */
export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  INTERRUPTED: 130,
};

export class CliError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   code?: string,
   *   exitCode?: number,
   *   hint?: string,
   *   details?: unknown,
   *   silent?: boolean,
   *   cause?: unknown,
   * }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.code = options.code ?? "CLI_ERROR";
    this.exitCode = options.exitCode ?? EXIT.FAILURE;
    this.hint = options.hint;
    this.details = options.details;
    this.silent = Boolean(options.silent);
  }
}

export class UsageError extends CliError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "USAGE_ERROR",
      exitCode: EXIT.USAGE,
    });
    this.name = "UsageError";
  }
}

/** Map a thrown value to the CLI's stable JSON error shape. */
export function errorToJson(error) {
  if (error instanceof CliError) {
    const result = {
      code: error.code,
      message: error.message,
    };
    if (error.hint) result.hint = error.hint;
    if (error.details !== undefined) result.details = error.details;
    return result;
  }

  if (error instanceof FxError) {
    const result = {
      code:
        error.name === "LexError"
          ? "LEX_ERROR"
          : error.name === "ParseError"
            ? "PARSE_ERROR"
            : error.name === "CompileError"
              ? "COMPILE_ERROR"
              : "FX_ERROR",
      message: error.message,
    };
    if (error.file != null) result.file = error.file;
    if (error.line != null) result.line = error.line;
    if (error.column != null) result.column = error.column;
    return result;
  }

  return {
    code: "COMMAND_ERROR",
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error),
  };
}

/** Human-readable error body, including a code frame when available. */
export function formatError(error, { verbose = false } = {}) {
  if (error instanceof FxError) return error.format();
  if (error instanceof CliError) {
    let text = error.message;
    if (Array.isArray(error.details?.problems) && error.details.problems.length)
      text += `\n${error.details.problems.map((line) => `  ${line}`).join("\n")}`;
    return text;
  }
  if (verbose && error instanceof Error && error.stack) return error.stack;
  return error instanceof Error ? error.message : String(error);
}

/** Exit code for an error that escaped a command handler. */
export function exitCodeFor(error) {
  if (error instanceof CliError) return error.exitCode;
  return EXIT.FAILURE;
}
