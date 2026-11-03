/**
 * Multi-file project assembly.
 *
 * A Triflare Fx project can be spread across any number of `.tfx` files in a
 * directory tree. This module discovers those files and merges their ASTs into
 * a single `Program`, so the rest of the pipeline keeps working with one AST.
 */
import fs from "node:fs";
import path from "node:path";
import { ParseError } from "./errors.js";
import { configFilename, sourceExtension } from "./brand.js";

/** Directories never scanned for `.tfx` sources. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".cache",
]);

/**
 * Recursively find every `.tfx` file under `dir`, skipping hidden entries and
 * well-known build/dependency directories. Results are deterministic (sorted by
 * path) so builds are reproducible.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
export function discoverSources(dir) {
  const root = path.resolve(dir);
  const found = [];
  const extension = sourceExtension().toLowerCase();

  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(extension)
      ) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found.sort();
}

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
 * @param {{partialSprites?: boolean}} [options]
 * @returns {object} a `Program` node
 */
export function mergePrograms(entries, { partialSprites = false } = {}) {
  let stage = null;
  const topItems = [];
  /** @type {Map<string, {name: string, loc: object, base: object|null, fragments: object[], files: string[]}>} */
  const groups = new Map();

  for (const { ast, file } of entries) {
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
            `set "fx.partialSprites: true" in ${configFilename()} to enable it`,
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
      partial: false,
      files: group.files,
    };
  });

  return { type: "Program", stage, sprites, topItems };
}
