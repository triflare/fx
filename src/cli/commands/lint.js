import fs from "node:fs";
import path from "node:path";
import { sourceExtension } from "../../brand.js";
import { discoverSources } from "../../project.js";
import { applyFixes, lintSources } from "../../linter.js";
import {
  effectivePreset,
  normalizeLintConfig,
  parseRuleOption,
} from "../../lint/config.js";
import { PRESET_NAMES, ruleById } from "../../lint/rules.js";
import { loadProjectState, resolveInput } from "../context.js";
import { outcome } from "../define-command.js";
import { EXIT, UsageError } from "../errors.js";
import { plural } from "../format.js";

const EXTENSION = sourceExtension();

/** Repeatable `--rule` values are collected into an array. */
function collect(value, previous = []) {
  return [...previous, value];
}

function displayPath(cwd, file) {
  const relativePath = path.relative(cwd, file);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath)
    ? file
    : relativePath;
}

/**
 * Resolve `--preset` and `--rule` on top of the project's `fx.lint` block.
 * A bare `--rule FX201` enables the rule at its default severity; `off`
 * disables it, and `error`/`warn` override the severity.
 */
function resolveOptions(options, loaded, product) {
  const lintConfig = normalizeLintConfig(loaded.fx?.lint ?? {}, (message) => {
    throw new UsageError(message, {
      hint: "check the lint block in fx.yml",
    });
  });

  if (options.preset != null) {
    const preset = String(options.preset).trim().toLowerCase();
    if (!PRESET_NAMES.includes(preset))
      throw new UsageError(`unknown lint preset: ${options.preset}`, {
        hint: `use one of: ${PRESET_NAMES.join(", ")}`,
      });
    lintConfig.extends = preset;
  }

  const overrides = {};
  for (const raw of options.rule ?? []) {
    const parsed = parseRuleOption(raw);
    const preset = parsed.id.toLowerCase();
    if (!parsed.severity && PRESET_NAMES.includes(preset)) {
      lintConfig.extends = preset;
      continue;
    }
    const rule = ruleById(parsed.id);
    if (!rule)
      throw new UsageError(`unknown lint rule: ${parsed.id}`, {
        hint: `run "${product.command} lint --help" for rule selection`,
      });
    if (!parsed.severity) {
      overrides[rule.id] = "error";
      continue;
    }
    if (!["error", "warning", "off"].includes(parsed.severity))
      throw new UsageError(
        `invalid severity for ${rule.id}: ${String(parsed.severity)}`,
        { hint: "use error, warn or off" },
      );
    overrides[rule.id] = parsed.severity;
  }

  return { lintConfig, overrides };
}

/** Strip fix internals and display paths relative to the working directory. */
function toJsonDiagnostic(diagnostic, cwd) {
  return {
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    category: diagnostic.category,
    message: diagnostic.message,
    file: diagnostic.file ? displayPath(cwd, diagnostic.file) : null,
    line: diagnostic.line,
    column: diagnostic.column,
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    explanation: diagnostic.explanation,
    fixable: diagnostic.fixable,
  };
}

function reportDiagnostics(reporter, diagnostics, cwd) {
  let current = null;
  for (const diagnostic of diagnostics) {
    const file = diagnostic.file
      ? displayPath(cwd, diagnostic.file)
      : "<input>";
    if (file !== current) {
      current = file;
      reporter.text(reporter.bold(file));
    }
    const mark =
      diagnostic.severity === "error"
        ? "error"
        : diagnostic.severity === "warning"
          ? "warn "
          : "info ";
    reporter.text(
      `  ${mark} ${diagnostic.line}:${diagnostic.column}  ${diagnostic.ruleId}  ${diagnostic.message}`,
    );
  }
}

export const lintCommand = {
  name: "lint",
  group: "Core Commands:",
  summary: "Report source and project problems",
  description: `Statically analyse a file, or every ${EXTENSION} file in a directory
(defaults to the working directory), plus the merged project. Rules come from
the "lint" block under "fx" in fx.yml; --preset and --rule override them.

Exit status is 1 when errors are reported, or when warnings are reported with
--strict. Linting never changes a file unless --fix is passed.`,
  arguments: [`[input${EXTENSION}|dir]`],
  options: [
    { flags: "--fix", description: "Apply safe, explicit fixes" },
    {
      flags: "--strict",
      description: "Use the strict preset and fail on warnings",
    },
    {
      flags: "--preset <name>",
      description: `Use a preset: ${PRESET_NAMES.join(", ")}`,
    },
    {
      flags: "--rule <id[=severity]>",
      description: "Enable, disable or set one rule (repeatable)",
      parser: collect,
      defaultValue: [],
    },
  ],
  examples: [
    "fx lint",
    "fx lint src/main.tfx",
    "fx lint --strict",
    "fx lint --json",
    "fx lint --rule FX201=off",
    "fx lint --fix",
  ],
  async run({ args, cwd, options, reporter, product }) {
    const target = resolveInput(args[0], cwd);
    const files = target.file ? [target.file] : discoverSources(target.dir);
    if (files.length === 0)
      throw new UsageError(`No ${EXTENSION} files found under ${target.dir}`);

    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      includeExtensions: true,
      migrateLegacy: false,
    });
    const { lintConfig, overrides } = resolveOptions(
      options,
      state.loaded,
      product,
    );
    const preset = effectivePreset(lintConfig, Boolean(options.strict));

    const lintOptions = {
      config: state.loaded,
      configPath: state.loaded.path,
      configDir: state.configDir,
      rootDir: state.configDir ?? cwd,
      extensionCatalog: state.catalog,
      lintConfig,
      strict: Boolean(options.strict),
      overrides,
    };

    let sources = files.map((file) => ({
      file,
      source: fs.readFileSync(file, "utf8"),
    }));
    let result = lintSources({ sources, ...lintOptions });
    let fixed = 0;

    if (options.fix) {
      const applied = applyFixes(sources, result.diagnostics);
      fixed = applied.fixed;
      if (fixed > 0) {
        for (const file of applied.files)
          fs.writeFileSync(file, applied.sources.get(file));
        sources = sources.map(({ file, source }) => ({
          file,
          source: applied.sources.get(file) ?? source,
        }));
        result = lintSources({ sources, ...lintOptions });
      }
    }

    if (!reporter.json) {
      reportDiagnostics(reporter, result.diagnostics, cwd);
      if (fixed > 0) reporter.info(`Fixed ${plural(fixed, "problem")}.`);
      const { errors, warnings } = result.summary;
      if (errors > 0 || warnings > 0) {
        const parts = [];
        if (errors > 0) parts.push(plural(errors, "error"));
        if (warnings > 0) parts.push(plural(warnings, "warning"));
        reporter.error(
          `${parts.join(", ")} in ${plural(files.length, "file")} (${preset} preset)`,
        );
      } else {
        reporter.success(
          `Linted ${plural(files.length, "file")}: no problems (${preset} preset)`,
        );
      }
    }

    const failsOnWarnings = Boolean(options.strict);
    const exitCode =
      result.summary.errors > 0 ||
      (failsOnWarnings && result.summary.warnings > 0)
        ? EXIT.FAILURE
        : EXIT.OK;

    return outcome({
      exitCode,
      data: {
        preset,
        strict: failsOnWarnings,
        fixed,
        files: files.map((file) => displayPath(cwd, file)),
        summary: result.summary,
        diagnostics: result.diagnostics.map((diagnostic) =>
          toJsonDiagnostic(diagnostic, cwd),
        ),
      },
    });
  },
};
