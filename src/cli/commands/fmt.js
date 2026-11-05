import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { sourceExtension } from "../../brand.js";
import { formatSource } from "../../formatter.js";
import { discoverSources } from "../../project.js";
import { resolveInput } from "../context.js";
import { outcome } from "../define-command.js";
import { EXIT, UsageError, errorToJson, formatError } from "../errors.js";
import { plural } from "../format.js";

const EXTENSION = sourceExtension();

function displayPath(cwd, file) {
  const relativePath = path.relative(cwd, file);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath)
    ? file
    : relativePath;
}

function readStdin() {
  if (process.stdin.isTTY)
    throw new UsageError("--stdin expects source on standard input", {
      hint: "pipe a file into standard input, such as: cat src/main.tfx",
    });
  return fs.readFileSync(0, "utf8");
}

export const fmtCommand = {
  name: "fmt",
  aliases: ["format"],
  group: "Core Commands:",
  summary: "Format sources into canonical style",
  description: `Rewrite a file, or every ${EXTENSION} file in a directory
(defaults to the working directory), in the canonical source format.
Formatting is idempotent, preserves comments and project data, and never
compiles a project, so it cannot change generated behavior.`,
  arguments: [`[input${EXTENSION}|dir]`],
  options: [
    {
      flags: "--check",
      description: "Do not write files; exit 1 if formatting is needed",
    },
    { flags: "--stdin", description: "Format source read from stdin" },
    {
      flags: "--stdout",
      description: "Write formatted source to stdout instead of files",
    },
  ],
  examples: [
    "fx fmt",
    "fx fmt src/main.tfx",
    "fx fmt --check",
    "fx fmt --stdin",
    "fx fmt src/main.tfx --stdout",
  ],
  async run({ args, cwd, options, reporter, product }) {
    if (options.stdin) {
      // Commander fills a missing optional argument with null.
      if (args[0] != null)
        throw new UsageError("--stdin does not take a file argument", {
          hint: `run "${product.command} fmt --stdin" with piped input`,
        });
      const source = readStdin();
      const code = formatSource(source, "<stdin>");
      const changed = code !== source;

      if (options.check) {
        if (changed) reporter.error("stdin is not formatted");
        else reporter.success("stdin is formatted");
        return outcome({
          exitCode: changed ? EXIT.FAILURE : EXIT.OK,
          data: { file: "<stdin>", changed, checked: true },
        });
      }

      const data = { file: "<stdin>", changed, checked: false };
      if (reporter.json) data.code = code;
      else reporter.raw(code);
      return outcome({ data });
    }

    const target = resolveInput(args[0], cwd);
    const files = target.file ? [target.file] : discoverSources(target.dir);
    if (files.length === 0)
      throw new UsageError(`No ${EXTENSION} files found under ${target.dir}`);
    if (options.stdout && options.check)
      throw new UsageError("--stdout cannot be combined with --check");
    if (options.stdout && !target.file)
      throw new UsageError(
        "--stdout requires a single file; pass one or use --stdin",
      );

    const results = [];
    let changed = 0;
    let parseErrors = 0;
    let stdoutCode = null;

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      let code;
      try {
        code = formatSource(source, file);
      } catch (error) {
        parseErrors += 1;
        results.push({
          file: displayPath(cwd, file),
          status: "error",
          changed: false,
          error: errorToJson(error),
        });
        reporter.error(formatError(error));
        continue;
      }

      const differs = code !== source;
      if (differs) changed += 1;
      results.push({
        file: displayPath(cwd, file),
        status: differs
          ? options.check
            ? "unformatted"
            : "formatted"
          : "unchanged",
        changed: differs,
      });

      if (options.stdout) {
        if (!options.check) {
          stdoutCode = code;
          reporter.raw(code);
        }
      } else if (differs && !options.check) {
        fs.writeFileSync(file, code);
        reporter.bullet(displayPath(cwd, file));
      } else if (differs) {
        reporter.bullet(displayPath(cwd, file));
      }
    }

    const data = {
      checked: Boolean(options.check),
      files: results,
      changed,
      unchanged: results.length - changed - parseErrors,
      parseErrors,
    };
    if (options.stdout && reporter.json) data.code = stdoutCode;

    if (!options.stdout) {
      if (options.check) {
        if (changed > 0)
          reporter.error(`${plural(changed, "file")} would be reformatted`);
        else if (parseErrors === 0)
          reporter.success(
            `Checked ${plural(files.length, "file")}: all formatted`,
          );
      } else if (changed > 0) {
        reporter.success(`Formatted ${plural(changed, "file")}`);
      } else if (parseErrors === 0) {
        reporter.success(
          `All ${plural(files.length, "file")} already formatted`,
        );
      }
    }

    const exitCode =
      parseErrors > 0 || (options.check && changed > 0)
        ? EXIT.FAILURE
        : EXIT.OK;
    return outcome({ exitCode, data });
  },
};
