/**
 * Triflare Fx linter rule metadata and presets.
 *
 * Rule IDs and categories are stable: tools, suppressions and `fx.yml` refer to
 * a rule by ID, and the category only groups diagnostics for presentation. A
 * rule that is not part of a preset is off unless `fx.lint.rules` (or
 * `--rule`) enables it explicitly, so the initial implementation can ship a
 * subset of the full ruleset without renumbering anything.
 */

/** Category labels, keyed by the prefix used in rule metadata. */
export const CATEGORIES = {
  syntax: "Syntax",
  names: "Names and scope",
  control: "Control flow",
  expressions: "Expressions and runtime behavior",
  project: "Assets, extensions, and project structure",
  maintainability: "Maintainability",
};

/** Severity a rule reports when it is enabled without an override. */
export const SEVERITIES = ["error", "warning", "off"];

/**
 * @typedef {object} Rule
 * @property {string} id stable rule ID, such as `FX201`
 * @property {string} category key of `CATEGORIES`
 * @property {'error'|'warning'} severity default severity
 * @property {string} summary one-line description
 * @property {string} explanation why the rule exists and what to do about it
 * @property {boolean} [fixable] whether `--fix` can repair it
 */

/** @type {Record<string, Rule>} */
export const RULES = {
  // ---------------------------------------------------------------- syntax
  FX000: {
    id: "FX000",
    category: "syntax",
    severity: "error",
    summary: "Parse or project error",
    explanation:
      "The source could not be parsed or the project could not be assembled, " +
      "so lint rules were not applied to it. Fix the reported syntax error " +
      "first; `fx check` reports the same problems.",
  },
  FX001: {
    id: "FX001",
    category: "syntax",
    severity: "error",
    summary: "Invalid lint suppression",
    explanation:
      "An `fx-lint` comment names a rule that does not exist, so the " +
      "suppression silently does nothing. Use a stable rule ID or remove the " +
      "comment.",
  },
  FX002: {
    id: "FX002",
    category: "syntax",
    severity: "warning",
    summary: "Unused lint suppression",
    explanation:
      "An `fx-lint` comment matches no diagnostic. Remove it so the reason for " +
      "the suppression does not outlive the problem.",
  },

  // ------------------------------------------------------- names and scope
  FX201: {
    id: "FX201",
    category: "names",
    severity: "error",
    summary: "Undefined variable",
    explanation:
      "A name is read as a variable but no `let`, `list` or function parameter " +
      "declares it, so the project fails to compile.",
  },
  FX202: {
    id: "FX202",
    category: "names",
    severity: "error",
    summary: "Undefined list",
    explanation:
      "A list method is called on a name that is not a declared list. Declare " +
      "it with `list <name> = [];` or check the spelling.",
  },
  FX203: {
    id: "FX203",
    category: "names",
    severity: "error",
    summary: "Read before initialization",
    explanation:
      "A declaration's initializer reads a variable or list declared later in " +
      "the same target. Initializers run in declaration order, so the later " +
      "declaration still holds its default value here.",
  },
  FX204: {
    id: "FX204",
    category: "names",
    severity: "error",
    summary: "Assignment creates an implicit variable",
    explanation:
      "Assigning to an undeclared name fails to compile. Declare it with " +
      "`let <name> = <value>;` first; `--fix` can insert the declaration.",
    fixable: true,
  },
  FX205: {
    id: "FX205",
    category: "names",
    severity: "warning",
    summary: "Local variable shadows a parameter",
    explanation:
      "A target-level `let` or `list` has the same name as a function " +
      "parameter, so inside that function the parameter hides the local. Rename " +
      "one of them to keep both reachable.",
  },
  FX206: {
    id: "FX206",
    category: "names",
    severity: "warning",
    summary: "Local variable shadows a project variable",
    explanation:
      "A sprite declares a variable or list with the same name as a stage " +
      "variable. The sprite copy hides the global one, which is easy to miss.",
  },
  FX207: {
    id: "FX207",
    category: "names",
    severity: "warning",
    summary: "Unused function parameter",
    explanation:
      "A parameter is never read in the function body. Remove it, or use it, " +
      "so call sites and the parameter list stay honest.",
  },
  FX208: {
    id: "FX208",
    category: "names",
    severity: "warning",
    summary: "Unused variable or list",
    explanation:
      "A variable or list is declared but never read or written. Remove the " +
      "declaration, or use it.",
  },
  FX209: {
    id: "FX209",
    category: "names",
    severity: "warning",
    summary: "Unused function",
    explanation:
      "A function is declared but never called. Remove it, or call it from a " +
      "hat.",
  },
  FX211: {
    id: "FX211",
    category: "names",
    severity: "warning",
    summary: "Declarations differ only by case",
    explanation:
      "Two declarations in the same target have names that differ only by " +
      "letter case. PenguinMod treats names loosely, so one shadows the other " +
      "in practice. Rename one of them.",
  },
  FX212: {
    id: "FX212",
    category: "names",
    severity: "error",
    summary: "Cloud variable declared outside the stage",
    explanation:
      "`cloud let` is only valid at the top level or inside `stage`; the " +
      "project fails to compile when a sprite declares one.",
  },
  FX214: {
    id: "FX214",
    category: "names",
    severity: "error",
    summary: "Reserved temporary-variable name",
    explanation:
      "Names starting with `$` or `$$` are read as thread/runtime temporary " +
      "variables, so they cannot be declared with `let`, `list` or a function " +
      "parameter. Rename the declaration, or use `thread let` / `runtime let`.",
  },

  // ----------------------------------------------------------- control flow
  FX101: {
    id: "FX101",
    category: "control",
    severity: "error",
    summary: "Unreachable statement",
    explanation:
      "Nothing can connect below `return`, `control.stop(...)` or " +
      "`control.deleteThisClone()`, so the following statement is dropped.",
  },
  FX301: {
    id: "FX301",
    category: "control",
    severity: "warning",
    summary: "Infinite loop with no yielding block",
    explanation:
      "A `forever` loop or a `while` loop whose condition is always true has a " +
      "body with nothing that yields: no wait, no loop, no user function call. " +
      "It spins in place instead of letting other scripts run.",
  },
  FX302: {
    id: "FX302",
    category: "control",
    severity: "warning",
    summary: "Statically constant loop condition",
    explanation:
      "The condition of a `while` loop is a constant, so the loop either never " +
      "runs or never stops. Use `forever` for the intentional case.",
  },
  FX304: {
    id: "FX304",
    category: "control",
    severity: "warning",
    summary: "Constant false or zero loop",
    explanation:
      "A `repeat` count is a constant that is zero or negative, so the body " +
      "never runs. This is almost always a leftover or a mistake.",
  },
  FX307: {
    id: "FX307",
    category: "control",
    severity: "error",
    summary: "Return outside a function",
    explanation:
      "`return` is only valid inside a `function`, `returning function` or " +
      "`warp function`.",
  },
  FX308: {
    id: "FX308",
    category: "control",
    severity: "error",
    summary: "Returning function has a path with no return",
    explanation:
      "A `returning function` can finish without a value, so callers receive " +
      "an empty result. End every branch with a `return`.",
  },
  FX309: {
    id: "FX309",
    category: "control",
    severity: "error",
    summary: "Value returned from a non-returning function",
    explanation:
      "Only a `returning function` may return a value; a plain or `warp` " +
      "function must use a bare `return;`.",
  },
  FX506: {
    id: "FX506",
    category: "control",
    severity: "warning",
    summary: "Warp function contains a yielding operation",
    explanation:
      "Blocks such as `control.wait`, `looks.sayForSecs` and " +
      "`event.broadcastAndWait` cannot yield inside a `warp function`, so the " +
      "whole call still runs in one frame. Remove the yielding block, or drop " +
      "`warp`.",
  },

  // ------------------------------------------ expressions and runtime behavior
  FX403: {
    id: "FX403",
    category: "expressions",
    severity: "warning",
    summary: "Condition is always truthy or falsy",
    explanation:
      "An `if` condition is a literal, so one branch is dead code. Check for a " +
      "comparison that was meant to be there.",
  },
  FX404: {
    id: "FX404",
    category: "expressions",
    severity: "error",
    summary: "Division or modulo by statically known zero",
    explanation:
      "Dividing by a literal zero makes PenguinMod report `Infinity` or " +
      "`NaN`, which quietly poisons every later calculation.",
  },

  // ---------------------------------- assets, extensions, and project structure
  FX701: {
    id: "FX701",
    category: "project",
    severity: "error",
    summary: "Missing asset",
    explanation:
      "A costume or sound path does not exist relative to the file that " +
      "declares it, so the build cannot register the asset.",
  },
  FX702: {
    id: "FX702",
    category: "project",
    severity: "warning",
    summary: "Unsupported or inefficient asset format",
    explanation:
      "PenguinMod loads costumes as SVG, PNG or JPG and sounds as WAV or MP3. " +
      "Convert other formats before building.",
  },
  FX703: {
    id: "FX703",
    category: "project",
    severity: "warning",
    summary: "Unused asset",
    explanation:
      "A file under `assets/` is never referenced by a costume or sound. " +
      "Remove it to keep the repository small.",
  },
  FX706: {
    id: "FX706",
    category: "project",
    severity: "warning",
    summary: "Mutable or unpinned extension source",
    explanation:
      "A remote extension is not pinned to a verified hash, so a later build " +
      "can silently load different code. Run `fx vendor install` to lock it.",
  },
  FX707: {
    id: "FX707",
    category: "project",
    severity: "warning",
    summary: "Stale vendored extension hash",
    explanation:
      "The vendored file differs from `fx.lock`. Run `fx vendor verify` for " +
      "details and `fx vendor install` to refresh the lock.",
  },
  FX708: {
    id: "FX708",
    category: "project",
    severity: "error",
    summary: "Unavailable extension",
    explanation:
      "A declared extension has no vendored file or no lock entry, so builds " +
      "that embed it fail. Run `fx vendor install`.",
  },
  FX709: {
    id: "FX709",
    category: "project",
    severity: "error",
    summary: "Unknown block or extension block",
    explanation:
      "A call does not name a catalog block, a list method or a declared " +
      "function. Check the block name and that its extension is declared in " +
      "`fx.yml`.",
  },
  FX803: {
    id: "FX803",
    category: "project",
    severity: "error",
    summary: "Partial sprite used without enabling partial sprites",
    explanation:
      "`partial sprite` fragments only merge when `fx.partialSprites: true` is " +
      "set in `fx.yml`.",
  },
  FX804: {
    id: "FX804",
    category: "project",
    severity: "warning",
    summary: "Partial sprite has no base declaration",
    explanation:
      'Every sprite needs one plain `sprite "Name" { }` declaration to define ' +
      "its costumes, sounds and layer. Partial fragments alone still build, " +
      "but the sprite has no base properties.",
  },

  // --------------------------------------------------------- maintainability
  FX901: {
    id: "FX901",
    category: "maintainability",
    severity: "warning",
    summary: "Excessive nesting",
    explanation:
      "Control blocks are nested more than four levels deep. Extract part of " +
      "the body into a function so the shape stays readable.",
  },
  FX902: {
    id: "FX902",
    category: "maintainability",
    severity: "warning",
    summary: "Excessive script length",
    explanation:
      "A single hat or function holds more than 60 statements. Split it into " +
      "smaller functions that each do one thing.",
  },
  FX908: {
    id: "FX908",
    category: "maintainability",
    severity: "warning",
    summary: "Missing documentation for public functions",
    explanation:
      "A function has no preceding `//` comment describing it. Add one line " +
      "that says what the function does.",
  },
};

/** Look up a rule by ID, case-insensitively. */
export function ruleById(id) {
  const key = String(id).trim().toUpperCase();
  return RULES[key] ?? null;
}

const MINIMAL = [
  "FX101",
  "FX201",
  "FX202",
  "FX204",
  "FX212",
  "FX214",
  "FX307",
  "FX404",
  "FX803",
];

const RECOMMENDED = [
  ...MINIMAL,
  "FX203",
  "FX205",
  "FX206",
  "FX211",
  "FX301",
  "FX302",
  "FX304",
  "FX308",
  "FX309",
  "FX506",
  "FX701",
  "FX702",
  "FX703",
  "FX706",
  "FX707",
  "FX708",
  "FX709",
  "FX804",
];

const STRICT = [
  ...RECOMMENDED,
  "FX207",
  "FX208",
  "FX209",
  "FX403",
  "FX901",
  "FX902",
  "FX908",
];

/**
 * Preset name -> enabled rule IDs. `all` deliberately lists every known rule
 * (including experimental ones added later), so a new rule only has to be
 * registered above to join it.
 */
/** Rules that describe lint machinery itself; always on, never configurable. */
export const META_RULE_IDS = ["FX000", "FX001", "FX002"];

export const PRESETS = {
  minimal: MINIMAL,
  recommended: RECOMMENDED,
  strict: STRICT,
  all: Object.keys(RULES).filter((id) => !META_RULE_IDS.includes(id)),
};

/** Preset names in escalation order. */
export const PRESET_NAMES = ["minimal", "recommended", "strict", "all"];
