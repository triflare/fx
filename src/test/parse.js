/**
 * Test-file parsing.
 *
 * A test file is a normal `.tfx` source with `test` declarations. Project
 * declarations (sprites, the stage, hats, project variables) are rejected:
 * tests reuse the language, not the project structure.
 */
import { parse } from "../parser.js";
import { ParseError } from "../errors.js";

const ALLOWED_TOP_LEVEL = new Set(["VarDecl", "FunctionDecl"]);

/**
 * @param {string} source
 * @param {string} file
 * @returns {{file: string, tests: object[], helpers: object[]}}
 */
export function parseTestFile(source, file = "<test>") {
  const ast = parse(source, file);

  if (ast.stage)
    throw new ParseError(
      "Test files cannot declare a stage; tests run against the project build",
      locationOf(ast.stage),
    );
  if (ast.sprites.length > 0)
    throw new ParseError(
      `Test files cannot declare sprites (found ${JSON.stringify(ast.sprites[0].name)})`,
      locationOf(ast.sprites[0]),
    );

  for (const item of ast.topItems) {
    if (!ALLOWED_TOP_LEVEL.has(item.type))
      throw new ParseError(
        "Test files may only declare tests, shared variables and shared functions",
        locationOf(item),
      );
  }

  return { file, tests: ast.tests, helpers: ast.topItems };
}

/** Source location of an AST node, defaulting unknown fields to null. */
function locationOf(node) {
  const loc = node?.loc ?? {};
  return { file: loc.file, line: loc.line, column: loc.column };
}

/**
 * Parse several test files. Errors are collected so a run can report every
 * broken file before failing with the language-error exit code.
 *
 * @param {Array<{file: string, source: string}>} entries
 * @returns {{files: Array<{file: string, tests: object[], helpers: object[]}>, diagnostics: object[]}}
 */
export function parseTests(entries) {
  const files = [];
  const diagnostics = [];
  for (const entry of entries) {
    try {
      files.push(parseTestFile(entry.source, entry.file));
    } catch (error) {
      diagnostics.push({
        file: entry.file,
        message: error.message,
        line: error.line ?? null,
        column: error.column ?? null,
      });
    }
  }
  return { files, diagnostics };
}
