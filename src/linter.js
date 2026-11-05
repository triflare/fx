/**
 * Triflare Fx linter (Node entry point).
 *
 * The rules that only need source text live in `lint/analyze.js` so browser
 * tooling can reuse them. This module adds the checks that need the
 * filesystem: asset files, `assets/` usage and vendored extension hashes.
 * Both sets of diagnostics share severity handling, suppressions and ordering.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "./parser.js";
import { readLock, verifyVendor } from "./vendor.js";
import {
  META_RULES,
  applyFixes,
  lintSources as lintAnalyze,
  sortDiagnostics,
} from "./lint/analyze.js";

export { META_RULES, applyFixes, sortDiagnostics };

/** Costume and sound formats PenguinMod can load. */
const COSTUME_FORMATS = new Set(["svg", "png", "jpg"]);
const SOUND_FORMATS = new Set(["wav", "mp3"]);

/** Walk every body list in a parsed program (stage, sprites, top items). */
function eachBody(ast, visit) {
  if (!ast) return;
  visit(ast.topItems ?? []);
  if (ast.stage) visit(ast.stage.body ?? []);
  for (const sprite of ast.sprites ?? []) visit(sprite.body ?? []);
}

/** Raw diagnostics for a project rule problem. */
function problem(ruleId, file, message, length = 1) {
  return { ruleId, file, line: 1, column: 1, message, length };
}

/** FX701/FX702/FX703: asset references on disk. */
function assetDiagnostics({ sources = [], configPath = null, rootDir = null }) {
  const diagnostics = [];
  const referenced = new Set();

  for (const { file, source } of sources) {
    let ast;
    try {
      ast = parse(source, file);
    } catch {
      continue; // FX000 already covers the parse error.
    }
    eachBody(ast, (body) => {
      for (const item of body) {
        if (item.type !== "PropertyDecl") continue;
        if (item.key !== "costumes" && item.key !== "sounds") continue;
        const formats =
          item.key === "costumes" ? COSTUME_FORMATS : SOUND_FORMATS;
        for (const entry of item.value) {
          const holder = entry.loc?.file ?? file;
          const absolute = path.resolve(path.dirname(holder), entry.value);
          referenced.add(absolute);
          if (!fs.existsSync(absolute)) {
            diagnostics.push({
              ruleId: "FX701",
              file: entry.loc?.file ?? file,
              line: entry.loc?.line ?? 1,
              column: entry.loc?.column ?? 1,
              length: String(entry.value).length,
              message: `Asset ${JSON.stringify(entry.value)} does not exist.`,
            });
          }
          const extension = path.extname(entry.value).slice(1).toLowerCase();
          if (extension && !formats.has(extension)) {
            diagnostics.push({
              ruleId: "FX702",
              file: entry.loc?.file ?? file,
              line: entry.loc?.line ?? 1,
              column: entry.loc?.column ?? 1,
              length: String(entry.value).length,
              message: `Asset ${JSON.stringify(entry.value)} uses .${extension}; use ${[...formats].map((format) => format.toUpperCase()).join(", ")}.`,
            });
          }
        }
      }
    });
  }

  const assetsDir = rootDir ? path.join(rootDir, "assets") : null;
  if (
    assetsDir &&
    fs.existsSync(assetsDir) &&
    fs.statSync(assetsDir).isDirectory()
  ) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && !referenced.has(full)) {
          diagnostics.push({
            ruleId: "FX703",
            file: full,
            line: 1,
            column: 1,
            message: `Asset ${JSON.stringify(path.relative(assetsDir, full))} is never used by a costume or sound.`,
          });
        }
      }
    };
    walk(assetsDir);
  }

  // `configPath` is unused for assets but keeps the call site symmetric.
  void configPath;
  return diagnostics;
}

/** FX706/FX707/FX708: extension sources and `fx.lock` verification. */
function extensionDiagnostics({
  config = null,
  configPath = null,
  configDir = null,
}) {
  const vendor = config?.vendor ?? [];
  const legacy = config?.project?.extensions ?? [];
  if (vendor.length === 0 && legacy.length === 0) return [];

  const diagnostics = [];
  const file = configPath ?? null;
  const lock = (() => {
    try {
      return readLock(configDir);
    } catch {
      return null;
    }
  })();

  for (const entry of vendor) {
    if (!entry.remote) continue;
    const locked = lock?.extensions?.[entry.name]?.sha256;
    if (!locked || entry.volatile) {
      diagnostics.push(
        problem(
          "FX706",
          file,
          `Extension ${JSON.stringify(entry.name)} loads mutable source ${JSON.stringify(entry.source)}; pin it with \`fx vendor install\`.`,
        ),
      );
    }
  }
  for (const source of legacy) {
    if (/^https?:\/\//i.test(String(source))) {
      diagnostics.push(
        problem(
          "FX706",
          file,
          `project.extensions loads mutable source ${JSON.stringify(String(source))}; move it under \`vendor:\` and pin it.`,
        ),
      );
    }
  }

  if (!configDir || !config) return diagnostics;
  let report;
  try {
    report = verifyVendor({ configDir, config });
  } catch (error) {
    diagnostics.push(problem("FX708", file, error.message));
    return diagnostics;
  }
  for (const record of report.entries ?? []) {
    if (record.status === "missing" || record.status === "unlocked") {
      diagnostics.push(
        problem(
          "FX708",
          file,
          `Extension ${JSON.stringify(record.name)} is unavailable in ${record.file ?? "the vendor directory"}; run \`fx vendor install\`.`,
        ),
      );
    } else if (
      record.status === "mismatch" ||
      record.status === "source-changed"
    ) {
      diagnostics.push(
        problem(
          "FX707",
          file,
          `Extension ${JSON.stringify(record.name)} does not match \`${path.basename(configPath ?? "fx.lock")}\`; run \`fx vendor verify\` for details.`,
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Lint sources plus the surrounding project.
 *
 * @param {{
 *   sources: Array<{file: string, source: string}>,
 *   config?: object|null,
 *   configPath?: string|null,
 *   configDir?: string|null,
 *   rootDir?: string|null,
 *   extensionCatalog?: Record<string, object>,
 *   declaredExtensions?: string[],
 *   lintConfig?: object,
 *   strict?: boolean,
 *   overrides?: Record<string, string>,
 * }} options
 */
export function lintSources(options = {}) {
  const extraDiagnostics = [
    ...assetDiagnostics(options),
    ...extensionDiagnostics(options),
  ];
  return lintAnalyze({ ...options, extraDiagnostics });
}
