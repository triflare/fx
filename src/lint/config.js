/**
 * `fx.lint` configuration and rule selection.
 *
 * Keeping this separate from the engine lets `src/config.js` validate the
 * `lint:` block without importing the analyzer (and its vendor/extension
 * dependencies), so configuration loading stays side-effect free.
 */

import {
  META_RULE_IDS,
  PRESET_NAMES,
  PRESETS,
  RULES,
  ruleById,
} from "./rules.js";

/** Default lint settings when `fx.yml` has no `lint:` block. */
export const DEFAULT_LINT = {
  extends: "recommended",
  rules: {},
};

const SEVERITY_ALIASES = {
  error: "error",
  warn: "warning",
  warning: "warning",
  off: "off",
  none: "off",
};

/**
 * Normalize a severity string.
 * @param {unknown} value
 * @returns {'error'|'warning'|'off'|null}
 */
export function normalizeSeverity(value) {
  if (typeof value !== "string") return null;
  return SEVERITY_ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * Validate and normalize an `fx.lint` mapping.
 *
 * @param {unknown} raw
 * @param {(message: string) => Error} [makeError]
 * @returns {{extends: string, rules: Record<string, 'error'|'warning'|'off'>}}
 */
export function normalizeLintConfig(
  raw = {},
  makeError = (message) => new Error(message),
) {
  const lint = { extends: DEFAULT_LINT.extends, rules: {} };
  if (raw == null) return lint;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw makeError("fx.lint must be a mapping");

  const unknownKeys = Object.keys(raw).filter(
    (key) => !["extends", "rules"].includes(key),
  );
  if (unknownKeys.length)
    throw makeError(
      `unknown fx.lint setting(s): ${unknownKeys
        .map((key) => `"${key}"`)
        .join(", ")}`,
    );

  if (raw.extends != null) {
    if (typeof raw.extends !== "string")
      throw makeError("fx.lint.extends must be a preset name");
    const preset = raw.extends.trim().toLowerCase();
    if (!PRESET_NAMES.includes(preset))
      throw makeError(
        `unknown lint preset ${JSON.stringify(raw.extends)}; ` +
          `expected one of: ${PRESET_NAMES.join(", ")}`,
      );
    lint.extends = preset;
  }

  if (raw.rules != null) {
    if (typeof raw.rules !== "object" || Array.isArray(raw.rules))
      throw makeError("fx.lint.rules must be a mapping of rule ID to severity");
    for (const [rawId, rawSeverity] of Object.entries(raw.rules)) {
      const rule = ruleById(rawId);
      if (!rule)
        throw makeError(
          `unknown lint rule ${JSON.stringify(rawId)} in fx.lint.rules`,
        );
      if (META_RULE_IDS.includes(rule.id))
        throw makeError(`fx.lint.rules cannot configure ${rule.id}`);
      const severity = normalizeSeverity(rawSeverity);
      if (!severity)
        throw makeError(
          `fx.lint.rules.${rawId} must be one of: error, warn, off`,
        );
      lint.rules[rule.id] = severity;
    }
  }

  return lint;
}

/**
 * Resolve every rule's effective severity for a lint run.
 *
 * Presets only decide which rules start enabled; overrides can enable a rule
 * outside the preset or turn one off. `strict` escalates the preset even when
 * `fx.yml` asks for something lower.
 *
 * @param {ReturnType<typeof normalizeLintConfig>} [lint]
 * @param {{strict?: boolean, overrides?: Record<string, string>}} [options]
 * @returns {Map<string, 'error'|'warning'|'off'>}
 */
export function resolveRuleSeverities(
  lint = DEFAULT_LINT,
  { strict = false, overrides = {} } = {},
) {
  const presetName = strict ? "strict" : (lint.extends ?? DEFAULT_LINT.extends);
  const enabled = new Set(PRESETS[presetName] ?? PRESETS.recommended);
  const severities = new Map();
  for (const id of Object.keys(RULES)) {
    if (META_RULE_IDS.includes(id)) continue;
    severities.set(id, enabled.has(id) ? RULES[id].severity : "off");
  }

  const apply = (rawOverrides) => {
    for (const [rawId, rawSeverity] of Object.entries(rawOverrides || {})) {
      const rule = ruleById(rawId);
      if (!rule) continue;
      const severity = normalizeSeverity(rawSeverity);
      if (!severity) continue;
      severities.set(rule.id, severity);
    }
  };
  apply(lint.rules);
  apply(overrides);
  return severities;
}

/**
 * Parse a `--rule` value: `FX201`, `FX201=error`, `FX201:off` or a preset
 * escalation such as `strict`. Unknown rules are reported by the caller so a
 * typo does not silently do nothing.
 *
 * @param {string} value
 * @returns {{id: string, severity?: string}}
 */
export function parseRuleOption(value) {
  const text = String(value).trim();
  const match = text.match(/^([^=:]+)\s*[=:]\s*(.+)$/);
  if (match)
    return {
      id: match[1].trim(),
      severity: normalizeSeverity(match[2]) ?? match[2].trim(),
    };
  return { id: text };
}
