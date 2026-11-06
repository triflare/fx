/**
 * Multi-file project merge.
 *
 * Kept separate from `project.js` because merging is pure: it needs no
 * filesystem access, so editor tooling (including the browser VS Code
 * extension host) can reuse it without pulling in `node:fs`.
 */
import { ParseError } from "./errors.js";

/** @param {object} loc */
function errorInfo(loc) {
  return {
    file: loc && loc.file,
    line: loc && loc.line,
    column: loc && loc.column,
  };
}

/**
 * Merge parsed programs into a single project AST.
 *
 * - At most one `stage { }` declaration is allowed across all files.
 * - Top-level statements from every file become stage content.
 * - At most one plain `sprite "Name" { }` declaration is allowed per name.
 *   Additional `partial sprite "Name" { }` fragments are appended to it.
 * - Partial sprites only merge when `partialSprites` is enabled.
 *
 * Bodies are composed base-first, then fragments in build order, so costume
 * order and local variable initializers stay predictable regardless of which
 * file happens to sort first.
 *
 * @param {Array<{ast: object, file: string}>} entries
 * @param {{partialSprites?: boolean, configName?: string}} [options]
 * @returns {object} a `Program` node
 */
export function mergePrograms(
  entries,
  { partialSprites = false, configName = "fx.yml" } = {},
) {
  let stage = null;
  const topItems = [];
  /** @type {Map<string, {name: string, loc: object, base: object|null, fragments: object[], files: string[]}>} */
  const groups = new Map();

  for (const { ast, file } of entries) {
    if (ast.tests && ast.tests.length > 0)
      throw new ParseError(
        `Test ${JSON.stringify(ast.tests[0].name)} is declared in a project source. ` +
          `Move test declarations to a test file (for example ` +
          `test/score.test.tfx); ordinary builds never compile test files.`,
        errorInfo(ast.tests[0].loc),
      );
    if (ast.stage) {
      if (stage) {
        throw new ParseError(
          "A project may only declare one stage",
          errorInfo(ast.stage.loc),
        );
      }
      stage = ast.stage;
    }
    topItems.push(...ast.topItems);
    for (const sprite of ast.sprites) {
      if (sprite.partial && !partialSprites) {
        throw new ParseError(
          `partial sprite ${JSON.stringify(sprite.name)} is disabled; ` +
            `set "fx.partialSprites: true" in ${configName} to enable it`,
          errorInfo(sprite.loc),
        );
      }

      let group = groups.get(sprite.name);
      if (!group) {
        group = {
          name: sprite.name,
          loc: sprite.loc,
          base: null,
          fragments: [],
          files: [],
        };
        groups.set(sprite.name, group);
      }
      group.files.push(file);

      if (sprite.partial) {
        group.fragments.push({ decl: sprite, file });
      } else if (group.base) {
        throw new ParseError(
          `Duplicate sprite ${JSON.stringify(sprite.name)} ` +
            `(declared in ${group.base.file} and ${file}); ` +
            `use \`partial sprite ${JSON.stringify(sprite.name)}\` to split it across files`,
          errorInfo(sprite.loc),
        );
      } else {
        group.base = { decl: sprite, file };
      }
    }
  }

  const sprites = [...groups.values()].map((group) => {
    const base = group.base ? [group.base.decl] : [];
    const fragments = group.fragments.map(({ decl }) => decl);
    const [first] = base.length ? base : fragments;
    return {
      type: "SpriteDecl",
      name: group.name,
      body: [...base, ...fragments].flatMap((decl) => decl.body),
      loc: first.loc,
      open: first.open ?? null,
      partial: false,
      files: group.files,
    };
  });

  return { type: "Program", stage, sprites, topItems };
}
