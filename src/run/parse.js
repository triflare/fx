/**
 * Run-file parsing.
 *
 * A run file is a normal `.tfx` source with function and variable declarations
 * only. It is never part of the project target: `fx run` merges it into an
 * in-memory build so the compiler can type-check the entry point and every
 * block it calls, then invokes `main` in the headless VM.
 */
import { parse } from "../parser.js";
import { ParseError } from "../errors.js";

const ALLOWED_TOP_LEVEL = new Set(["VarDecl", "FunctionDecl"]);

/** Source location of an AST node, defaulting unknown fields to null. */
function locationOf(node) {
  const loc = node?.loc ?? {};
  return { file: loc.file, line: loc.line, column: loc.column };
}

/**
 * Parse one run file.
 *
 * A helper-only file is allowed, so a project can split shared functions from
 * the entry point. `parseRuns` requires exactly one `main` across all files.
 *
 * @param {string} source
 * @param {string} file
 * @returns {{file: string, ast: object, main: object|null, helpers: object[]}}
 */
export function parseRunFile(source, file = "<run>") {
  const ast = parse(source, file);

  if (ast.stage)
    throw new ParseError(
      "Run files cannot declare a stage; runs execute against the project build",
      locationOf(ast.stage),
    );
  if (ast.sprites.length > 0)
    throw new ParseError(
      `Run files cannot declare sprites (found ${JSON.stringify(ast.sprites[0].name)})`,
      locationOf(ast.sprites[0]),
    );
  if ((ast.tests ?? []).length > 0)
    throw new ParseError(
      "Run files cannot declare tests; move them to a test file",
      locationOf(ast.tests[0]),
    );

  for (const item of ast.topItems) {
    if (!ALLOWED_TOP_LEVEL.has(item.type))
      throw new ParseError(
        "Run files may only declare shared variables and functions",
        locationOf(item),
      );
  }

  const mains = ast.topItems.filter(
    (item) => item.type === "FunctionDecl" && item.name === "main",
  );
  if (mains.length > 1)
    throw new ParseError(
      "A run file can only declare one `main` function",
      locationOf(mains[1]),
    );
  const main = mains[0] ?? null;
  if (main && main.params.length > 0)
    throw new ParseError(
      "The run entry point `main` must not take parameters",
      locationOf(main),
    );

  return { file, ast, main, helpers: ast.topItems };
}

/**
 * Parse several run files and require one entry point.
 *
 * @param {Array<{file: string, source: string}>} entries
 * @returns {Array<{file: string, ast: object, main: object|null, helpers: object[]}>}
 */
export function parseRuns(entries) {
  const files = entries.map((entry) => parseRunFile(entry.source, entry.file));
  const mains = files.filter((file) => file.main);
  if (files.length === 0) return files;
  if (mains.length === 0)
    throw new ParseError(
      "Run files must declare an entry point: `function main() { ... }`.",
      { file: files[0].file, line: 1, column: 1 },
    );
  if (mains.length > 1) {
    const first = mains[0].file;
    const second = mains[1].file;
    throw new ParseError(
      `Only one run file may declare \`main\` (found in ${first} and ${second})`,
      locationOf(mains[1].main),
    );
  }
  return files;
}
