/**
 * Browser-safe lint analyzer.
 *
 * This is the part of the linter that only needs source text: parsing, the AST
 * rules, suppressions, severity selection and fixes. It deliberately imports
 * no Node built-ins, so the same implementation powers `fx lint` and the VS
 * Code extension (including its browser extension host). The Node-only project
 * checks (assets on disk, `fx.lock` verification) live in `src/linter.js` and
 * arrive here as `extraDiagnostics`.
 */

import { CATALOG, LIST_OPS } from "../catalog.js";
import { ParseError } from "../errors.js";
import { tokenizeWithComments } from "../lexer.js";
import { mergePrograms } from "../merge.js";
import { parse } from "../parser.js";
import { DEFAULT_LINT, resolveRuleSeverities } from "./config.js";
import { RULES, ruleById } from "./rules.js";

/** Rules that describe linter/project machinery and are never configurable. */
export const META_RULES = new Set(["FX000", "FX001", "FX002"]);

/** Control blocks nested deeper than this are reported by FX901. */
export const MAX_NESTING = 4;

/** A single hat or function with more statements is reported by FX902. */
export const MAX_SCRIPT_STATEMENTS = 60;

/** List method aliases, mapped to their canonical method name. */
const LIST_METHODS = new Map();
for (const [name, entry] of Object.entries(LIST_OPS)) {
  LIST_METHODS.set(name, name);
  for (const alias of entry.aliases ?? []) LIST_METHODS.set(alias, name);
}

/** Catalog blocks that hand control back to the scheduler. */
const YIELDING_BLOCKS = new Set([
  "control.wait",
  "control.waitUntil",
  "looks.sayForSecs",
  "looks.thinkForSecs",
  "looks.switchBackdropAndWait",
  "sound.playUntilDone",
  "sensing.askAndWait",
  "event.broadcastAndWait",
  "motion.glideTo",
  "motion.glideToXY",
]);

// ---------------------------------------------------------------- utilities

/** Scratch-style truthiness of a static literal value. */
function truthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  const text = String(value).trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "false";
}

/**
 * Evaluate an expression whose value is known before the project runs.
 * Returns `null` when the value depends on runtime state.
 */
function staticValue(expr) {
  if (!expr) return null;
  switch (expr.type) {
    case "Number":
    case "String":
    case "Boolean":
      return expr.value;
    case "Unary": {
      const value = staticValue(expr.operand);
      if (value === null) return null;
      if (expr.op === "not") return !truthy(value);
      if (expr.op === "-") return typeof value === "number" ? -value : null;
      return null;
    }
    case "Binary": {
      const left = staticValue(expr.left);
      const right = staticValue(expr.right);
      if (expr.op === "and") {
        if (left !== null && !truthy(left)) return false;
        if (left !== null && right !== null) return truthy(right);
        return null;
      }
      if (expr.op === "or") {
        if (left !== null && truthy(left)) return true;
        if (left !== null && right !== null) return truthy(right);
        return null;
      }
      if (left === null || right === null) return null;
      switch (expr.op) {
        case "==":
          return String(left) === String(right);
        case "!=":
          return String(left) !== String(right);
        case "<":
          return Number(left) < Number(right);
        case "<=":
          return Number(left) <= Number(right);
        case ">":
          return Number(left) > Number(right);
        case ">=":
          return Number(left) >= Number(right);
        case "+":
          if (typeof left === "number" && typeof right === "number")
            return left + right;
          if (typeof left === "string" || typeof right === "string")
            return `${left}${right}`;
          return null;
        case "-":
        case "*":
          if (typeof left === "number" && typeof right === "number")
            return expr.op === "-" ? left - right : left * right;
          return null;
        case "/":
        case "%":
          if (typeof left !== "number" || typeof right !== "number")
            return null;
          if (right === 0) return null; // FX404 owns this case
          return expr.op === "/" ? left / right : left % right;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** Whether a statement ends the script it belongs to. */
function isTerminalCall(node) {
  if (node.type === "Return") return true;
  if (node.type !== "BlockCall") return false;
  if (node.name === "control.deleteThisClone") return true;
  if (node.name !== "control.stop") return false;
  const option = node.args[0];
  if (!option) return true;
  return (
    option.type === "String" && ["all", "this script"].includes(option.value)
  );
}

/** Descriptive text for the block that ends a script. */
function terminalDescription(node) {
  if (node.type === "Return") return "`return`";
  if (node.name === "control.stop") return "`control.stop(...)`";
  return `\`${node.name}()\``;
}

/** Count statements in a hat or function body, including nested blocks. */
function countStatements(statements) {
  let total = 0;
  const visit = (list) => {
    for (const statement of list ?? []) {
      total += 1;
      if (statement.type === "If") {
        visit(statement.then);
        visit(statement.else);
      } else if (
        statement.type === "Repeat" ||
        statement.type === "While" ||
        statement.type === "Forever"
      ) {
        visit(statement.body);
      } else if (statement.type === "BlockCall") {
        visit(statement.body);
        visit(statement.else);
      }
    }
  };
  visit(statements);
  return total;
}

/** Whether every path through a `returning function` ends with a return. */
function alwaysReturns(statements) {
  for (const statement of statements ?? []) {
    if (statement.type === "Return") return true;
    if (
      statement.type === "If" &&
      statement.else &&
      alwaysReturns(statement.then) &&
      alwaysReturns(statement.else)
    ) {
      return true;
    }
  }
  return false;
}

/** Declaration tables for one target's top-level items. */
function collectDeclarations(items) {
  const vars = new Map();
  const lists = new Map();
  const funcs = new Map();
  const order = [];
  items.forEach((item, index) => {
    if (item.type === "VarDecl") {
      vars.set(item.name, item);
      order.push({ kind: "value", node: item, index });
    } else if (item.type === "ListDecl") {
      lists.set(item.name, item);
      order.push({ kind: "value", node: item, index });
    } else if (item.type === "FunctionDecl") {
      funcs.set(item.name, item);
      order.push({ kind: "func", node: item, index });
    }
  });
  return { vars, lists, funcs, order };
}

/** Build stage and sprite targets, mirroring how the compiler hoists names. */
function buildTargets(program) {
  const stageBody = program.stage ? program.stage.body : [];
  const stageItems = [...stageBody, ...program.topItems];
  const stageLoc = program.stage?.loc ??
    stageItems[0]?.loc ?? { file: null, line: 1, column: 1 };
  const stage = {
    name: "Stage",
    isStage: true,
    loc: stageLoc,
    // Only a real `stage {` block has a brace to insert declarations into.
    openLine: program.stage ? (program.stage.loc?.line ?? 1) : null,
    items: stageItems,
    decls: collectDeclarations(stageItems),
    usage: { vars: new Set(), lists: new Set(), funcs: new Set() },
  };
  const sprites = program.sprites.map((sprite) => ({
    name: sprite.name,
    isStage: false,
    loc: sprite.loc,
    openLine: sprite.loc?.line ?? null,
    items: sprite.body,
    decls: collectDeclarations(sprite.body),
    usage: { vars: new Set(), lists: new Set(), funcs: new Set() },
  }));
  return { stage, sprites, globals: stage.decls };
}

/** Normalize a source location into the diagnostic range shape. */
function rangeOf(loc, length = 1) {
  const line = loc?.line ?? 1;
  const column = loc?.column ?? 1;
  return {
    file: loc?.file ?? null,
    line,
    column,
    endLine: line,
    endColumn: column + Math.max(0, length),
  };
}

/** Last path segment, without importing `node:path`. */
function baseName(file) {
  const parts = String(file ?? "").split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

// ----------------------------------------------------------------- analyzer

class Analyzer {
  /**
   * @param {{
   *   severities: Map<string, string>,
   *   catalog: Record<string, object>,
   *   extensionIds: Set<string>,
   *   declaredExtensions: Set<string>,
   *   sourceText: (file: string) => string|null,
   * }} options
   */
  constructor({
    severities,
    catalog,
    extensionIds,
    declaredExtensions,
    sourceText,
  }) {
    this.severities = severities;
    this.catalog = catalog;
    this.extensionIds = extensionIds;
    this.declaredExtensions = declaredExtensions;
    this.sourceText = sourceText;
    this.diagnostics = [];
    this.globalUsage = { vars: new Set(), lists: new Set() };
    this.paramUsage = new Map();
  }

  /** Whether a rule is enabled for this run. */
  enabled(id) {
    return META_RULES.has(id) || this.severities.get(id) !== "off";
  }

  /** Append one diagnostic, tagged with its stable metadata. */
  report(id, loc, message, { length = 1, fix = null } = {}) {
    if (!this.enabled(id)) return;
    const rule = RULES[id];
    this.diagnostics.push({
      ruleId: id,
      severity: META_RULES.has(id) ? rule.severity : this.severities.get(id),
      category: rule.category,
      message,
      ...rangeOf(loc, length),
      explanation: rule.explanation,
      fixable: Boolean(rule.fixable),
      ...(fix ? { fix } : {}),
    });
  }

  // ------------------------------------------------------------ resolution

  resolveName(env, params, name) {
    if (params?.has(name)) return { kind: "param", name, scope: "param" };
    const { target, globals } = env;
    if (target.decls.vars.has(name))
      return {
        kind: "var",
        name,
        scope: target.isStage ? "global" : "local",
      };
    if (target.decls.lists.has(name))
      return {
        kind: "list",
        name,
        scope: target.isStage ? "global" : "local",
      };
    if (globals.vars.has(name)) return { kind: "var", name, scope: "global" };
    if (globals.lists.has(name)) return { kind: "list", name, scope: "global" };
    return null;
  }

  markUsage(state, resolved) {
    if (resolved.kind === "param") {
      const used = this.paramUsage.get(state.func);
      if (used) used.add(resolved.name);
      return;
    }
    const bucket = resolved.kind === "var" ? "vars" : "lists";
    if (resolved.scope === "local")
      state.env.target.usage[bucket].add(resolved.name);
    else this.globalUsage[bucket].add(resolved.name);
  }

  checkIdentifier(expr, state) {
    if (expr.segments.length > 1) {
      this.report(
        "FX201",
        expr.loc,
        `Dotted name ${JSON.stringify(expr.name)} cannot be read as a variable.`,
        { length: expr.name.length },
      );
      return;
    }
    const resolved = this.resolveName(state.env, state.params, expr.name);
    if (!resolved) {
      this.report(
        "FX201",
        expr.loc,
        `Variable ${JSON.stringify(expr.name)} is not declared.`,
        { length: expr.name.length },
      );
      return;
    }
    this.markUsage(state, resolved);
  }

  /**
   * Resolve a call, reporting the rule that matches its failure mode.
   * @returns {{kind: 'list'|'catalog'|'function'|'extension'|'unknown', entry?: object}}
   */
  resolveCall(node, state) {
    const { segments, name } = node;
    if (segments.length === 2) {
      const method = LIST_METHODS.get(segments[1]);
      if (method) {
        const resolved = this.resolveName(state.env, state.params, segments[0]);
        if (resolved?.kind === "list") {
          this.markUsage(state, resolved);
          return { kind: "list" };
        }
        // A catalog block may share a method name (`looks.show`, `pen.clear`),
        // and the compiler prefers the catalog when the base is not a list.
        const entry = this.catalog[name];
        if (entry) return { kind: "catalog", entry };
        this.report(
          "FX202",
          node.loc,
          resolved
            ? `${JSON.stringify(segments[0])} is not a list, so ${name}() cannot be called on it.`
            : `List ${JSON.stringify(segments[0])} is not declared.`,
          { length: name.length },
        );
        return { kind: "unknown" };
      }
    }

    const entry = this.catalog[name];
    if (entry) return { kind: "catalog", entry };

    if (segments.length === 1 && state.env.target.decls.funcs.has(name)) {
      state.env.target.usage.funcs.add(name);
      return { kind: "function" };
    }

    const prefix = segments.length > 1 ? segments[0] : null;
    const verified = Boolean(prefix && this.extensionIds.has(prefix));
    const declared = Boolean(prefix && this.declaredExtensions.has(prefix));
    // Editors know which extensions are declared but do not execute their
    // metadata, so an unverifiable block from a declared extension is not a
    // diagnostic there (the CLI, which loads the catalog, still reports it).
    if (declared && !verified) return { kind: "extension" };

    const hint = verified
      ? ` Extension ${JSON.stringify(prefix)} is loaded but has no such block.`
      : "";
    this.report(
      "FX709",
      node.loc,
      `Unknown block or function ${JSON.stringify(name)}.${hint}`,
      { length: name.length },
    );
    return { kind: "unknown" };
  }

  checkYield(node, state) {
    if (!state.inWarp || state.warpYieldReported) return;
    if (!YIELDING_BLOCKS.has(node.name)) return;
    state.warpYieldReported = true;
    this.report(
      "FX506",
      node.loc,
      `Warp function ${JSON.stringify(state.func.name)} calls ${node.name}(), which cannot yield inside warp.`,
      { length: node.name.length },
    );
  }

  // ----------------------------------------------------------- expressions

  walkExpression(expr, state) {
    if (!expr) return;
    switch (expr.type) {
      case "Identifier":
        this.checkIdentifier(expr, state);
        break;
      case "Call": {
        this.resolveCall(expr, state);
        this.checkYield(expr, state);
        for (const arg of expr.args) this.walkExpression(arg, state);
        break;
      }
      case "Binary":
        this.checkDivideByZero(expr);
        this.walkExpression(expr.left, state);
        this.walkExpression(expr.right, state);
        break;
      case "Unary":
        this.walkExpression(expr.operand, state);
        break;
      case "ArrayLiteral":
        for (const item of expr.items) this.walkExpression(item, state);
        break;
      default:
        break;
    }
  }

  checkDivideByZero(expr) {
    if (expr.op !== "/" && expr.op !== "%") return;
    const divisor = staticValue(expr.right);
    if (typeof divisor === "number" && divisor === 0) {
      this.report(
        "FX404",
        expr.loc,
        `Division by a constant zero${expr.op === "%" ? " (modulo)" : ""} yields Infinity or NaN.`,
        { length: 1 },
      );
    }
  }

  // ------------------------------------------------------------ statements

  walkStatements(statements, state) {
    let terminal = null;
    for (const statement of statements ?? []) {
      if (terminal) {
        this.report(
          "FX101",
          statement.loc,
          `Unreachable statement: nothing can follow ${terminal}.`,
          { length: 1 },
        );
      }
      this.walkStatement(statement, state);
      if (isTerminalCall(statement)) terminal = terminalDescription(statement);
    }
  }

  enterBlock(node, state) {
    const nesting = state.nesting + 1;
    if (nesting > MAX_NESTING) {
      this.report(
        "FX901",
        node.loc,
        `Control blocks are nested ${nesting} levels deep; keep nesting at ${MAX_NESTING} or less.`,
        { length: 1 },
      );
    }
    return { ...state, nesting };
  }

  walkStatement(statement, state) {
    switch (statement.type) {
      case "VarDecl":
      case "ListDecl":
        // Nested declarations are not hoisted by the compiler; their
        // initializers still contribute references.
        if (statement.type === "VarDecl")
          this.walkExpression(statement.init, state);
        else
          for (const item of statement.items) this.walkExpression(item, state);
        break;
      case "PropertyDecl":
      case "FunctionDecl":
      case "HatDecl":
        break;
      case "If": {
        const value = staticValue(statement.cond);
        if (value !== null) {
          this.report(
            "FX403",
            statement.cond.loc,
            `Condition is always ${truthy(value) ? "true" : "false"}, so one branch is dead.`,
            { length: 1 },
          );
        }
        this.walkExpression(statement.cond, state);
        const inner = this.enterBlock(statement, state);
        this.walkStatements(statement.then, inner);
        this.walkStatements(statement.else, inner);
        break;
      }
      case "Repeat": {
        const count = staticValue(statement.count);
        if (typeof count === "number" && count <= 0) {
          this.report(
            "FX304",
            statement.count.loc,
            `repeat (${count}) never runs its body.`,
            { length: 1 },
          );
        }
        this.walkExpression(statement.count, state);
        this.walkStatements(statement.body, this.enterBlock(statement, state));
        break;
      }
      case "While": {
        const value = staticValue(statement.cond);
        if (value !== null) {
          this.report(
            "FX302",
            statement.cond.loc,
            `Loop condition is always ${truthy(value) ? "true" : "false"}.`,
            { length: 1 },
          );
        }
        if (truthy(value) && !this.bodyYields(statement.body, state)) {
          this.report(
            "FX301",
            statement.loc,
            "Infinite loop body has nothing that yields, so other scripts cannot run.",
            { length: 5 },
          );
        }
        this.walkExpression(statement.cond, state);
        this.walkStatements(statement.body, this.enterBlock(statement, state));
        break;
      }
      case "Forever": {
        if (!this.bodyYields(statement.body, state)) {
          this.report(
            "FX301",
            statement.loc,
            "Infinite loop body has nothing that yields, so other scripts cannot run.",
            { length: 7 },
          );
        }
        this.walkStatements(statement.body, this.enterBlock(statement, state));
        break;
      }
      case "Return":
        if (state.funcDepth === 0) {
          this.report(
            "FX307",
            statement.loc,
            "`return` is only valid inside a function.",
            { length: 6 },
          );
        }
        if (statement.value && state.func && !state.func.returns) {
          this.report(
            "FX309",
            statement.loc,
            `Function ${JSON.stringify(state.func.name)} is not a returning function, so it cannot return a value.`,
            { length: 6 },
          );
        }
        this.walkExpression(statement.value, state);
        break;
      case "Assign":
        this.walkAssign(statement, state);
        break;
      case "BlockCall":
        this.walkBlockCall(statement, state);
        break;
      default:
        break;
    }
  }

  walkAssign(statement, state) {
    const resolved = this.resolveName(state.env, state.params, statement.name);
    if (!resolved || resolved.kind !== "var") {
      this.report(
        "FX204",
        statement.loc,
        `Assignment to undeclared variable ${JSON.stringify(statement.name)}; declare it with \`let ${statement.name} = <value>;\`.`,
        {
          length: statement.name.length,
          fix:
            state.env.target.openLine == null
              ? null
              : {
                  kind: "declare-variable",
                  name: statement.name,
                  file: state.env.target.loc?.file ?? null,
                  targetLine: state.env.target.openLine,
                  indent: "    ",
                },
        },
      );
    } else {
      this.markUsage(state, resolved);
    }
    if (statement.op === "/=") {
      const divisor = staticValue(statement.value);
      if (typeof divisor === "number" && divisor === 0) {
        this.report(
          "FX404",
          statement.loc,
          "Dividing by a constant zero yields Infinity or NaN.",
          { length: statement.name.length },
        );
      }
    }
    this.walkExpression(statement.value, state);
  }

  walkBlockCall(statement, state) {
    this.resolveCall(statement, state);
    this.checkYield(statement, state);
    for (const arg of statement.args) this.walkExpression(arg, state);
    if (statement.body) {
      const inner = this.enterBlock(statement, state);
      this.walkStatements(statement.body, inner);
      this.walkStatements(statement.else, inner);
    }
  }

  /** Whether a loop body contains a block that lets the scheduler step. */
  bodyYields(statements, state) {
    for (const statement of statements ?? []) {
      if (
        statement.type === "Forever" ||
        statement.type === "Repeat" ||
        statement.type === "While"
      ) {
        return true; // loops yield at the end of every iteration
      }
      if (statement.type === "BlockCall") {
        if (
          YIELDING_BLOCKS.has(statement.name) ||
          state.env.target.decls.funcs.has(statement.name)
        ) {
          return true;
        }
        if (
          this.bodyYields(statement.body, state) ||
          this.bodyYields(statement.else, state)
        ) {
          return true;
        }
      } else if (statement.type === "If") {
        if (
          this.bodyYields(statement.then, state) ||
          this.bodyYields(statement.else, state)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------- target rules

  analyzeProgram(program) {
    const { stage, sprites, globals } = buildTargets(program);
    for (const target of [stage, ...sprites])
      this.analyzeTarget(target, globals);
    // Sprite reads feed `globalUsage`, so unused stage names are decided only
    // after every target has been analyzed.
    this.checkGlobalUsage(globals);
    return this.diagnostics;
  }

  analyzeTarget(target, globals) {
    const env = { target, globals };
    for (const item of target.items) {
      if (item.type === "VarDecl" || item.type === "ListDecl")
        this.checkInitializer(item, target, globals);
    }

    for (const item of target.items) {
      if (item.type === "FunctionDecl") {
        this.checkDocumentation(item);
        this.checkScriptLength(item.body, item.loc);
        if (item.returns && !alwaysReturns(item.body)) {
          this.report(
            "FX308",
            item.loc,
            `Returning function ${JSON.stringify(item.name)} has a path that does not return a value.`,
            { length: item.name.length },
          );
        }
        this.paramUsage.set(item, new Set());
        const state = {
          env,
          params: new Map(item.params.map((param) => [param.name, param])),
          func: item,
          funcDepth: 1,
          nesting: 0,
          inWarp: Boolean(item.warp),
          warpYieldReported: false,
        };
        this.walkStatements(item.body, state);
      } else if (item.type === "HatDecl") {
        this.checkScriptLength(item.body, item.loc);
        const state = {
          env,
          params: null,
          func: null,
          funcDepth: 0,
          nesting: 0,
          inWarp: false,
          warpYieldReported: false,
        };
        this.walkStatements(item.body, state);
      }
    }

    this.checkDeclarations(target, globals);
  }

  /** FX203: initializers that read a declaration made later in the target. */
  checkInitializer(decl, target, globals) {
    const index = new Map();
    target.items.forEach((item, position) => {
      if (item.type !== "VarDecl" && item.type !== "ListDecl") return;
      if (!index.has(item.name)) index.set(item.name, position);
    });
    const position = target.items.indexOf(decl);
    const state = {
      env: { target, globals },
      params: null,
      func: null,
      funcDepth: 0,
      nesting: 0,
      inWarp: false,
      warpYieldReported: false,
    };
    const visit = (expr) => {
      if (!expr) return;
      if (expr.type === "Identifier") {
        const later = index.get(expr.name);
        if (later !== undefined && later > position) {
          this.report(
            "FX203",
            expr.loc,
            `${JSON.stringify(expr.name)} is declared later in this target, so this initializer reads its default value.`,
            { length: expr.name.length },
          );
        }
        this.walkExpression(expr, state);
        return;
      }
      if (expr.type === "Binary") {
        visit(expr.left);
        visit(expr.right);
      } else if (expr.type === "Unary") {
        visit(expr.operand);
      } else if (expr.type === "ArrayLiteral") {
        for (const item of expr.items) visit(item);
      } else if (expr.type === "Call") {
        this.walkExpression(expr, state);
      }
    };
    if (decl.type === "VarDecl") visit(decl.init);
    else for (const item of decl.items) visit(item);
  }

  checkScriptLength(statements, loc) {
    const total = countStatements(statements);
    if (total > MAX_SCRIPT_STATEMENTS) {
      this.report(
        "FX902",
        loc,
        `Script has ${total} statements; split it into smaller functions.`,
        { length: 1 },
      );
    }
  }

  /** FX908: a public function should carry a `//` comment above it. */
  checkDocumentation(decl) {
    const text = decl.loc?.file ? this.sourceText(decl.loc.file) : null;
    if (!text) return;
    const lines = text.split(/\r?\n/);
    let above = (decl.loc?.line ?? 1) - 2;
    while (above >= 0 && lines[above].trim() === "") above -= 1;
    if (above < 0) return;
    const trimmed = lines[above].trim();
    if (trimmed.startsWith("//") || trimmed.endsWith("*/")) return;
    this.report(
      "FX908",
      decl.loc,
      `Function ${JSON.stringify(decl.name)} has no documentation comment.`,
      { length: decl.name.length },
    );
  }

  /** Declaration-level rules: shadowing, unused names, case collisions. */
  checkDeclarations(target, globals) {
    const { decls } = target;

    for (const [, decl] of [...decls.vars, ...decls.lists]) {
      if (decl.type === "VarDecl" && decl.cloud && !target.isStage) {
        this.report(
          "FX212",
          decl.loc,
          `Cloud variable ${JSON.stringify(decl.name)} must be declared at the top level or inside \`stage\`.`,
          { length: decl.name.length },
        );
      }
    }

    // Shadowing: target-level names hide parameters and stage variables.
    for (const [, fn] of decls.funcs) {
      for (const param of fn.params) {
        const local = decls.vars.get(param.name) ?? decls.lists.get(param.name);
        if (local) {
          this.report(
            "FX205",
            local.loc,
            `Local ${local.type === "ListDecl" ? "list" : "variable"} ${JSON.stringify(param.name)} shadows a parameter of function ${JSON.stringify(fn.name)}.`,
            { length: param.name.length },
          );
        }
      }
    }
    if (!target.isStage) {
      for (const [, decl] of [...decls.vars, ...decls.lists]) {
        if (globals.vars.has(decl.name) || globals.lists.has(decl.name)) {
          this.report(
            "FX206",
            decl.loc,
            `${JSON.stringify(decl.name)} shadows the project variable of the same name declared on the stage.`,
            { length: decl.name.length },
          );
        }
      }
    }

    // Case-only collisions within each namespace.
    const collisions = new Map();
    for (const entry of decls.order) {
      const key = `${entry.kind}:${entry.node.name.toLowerCase()}`;
      const first = collisions.get(key);
      if (!first) collisions.set(key, entry);
      else if (first.node.name !== entry.node.name) {
        this.report(
          "FX211",
          entry.node.loc,
          `Declarations ${JSON.stringify(first.node.name)} and ${JSON.stringify(entry.node.name)} differ only by case.`,
          { length: entry.node.name.length },
        );
      }
    }

    // Unused declarations. Stage (global) names are checked separately, once
    // every sprite has had a chance to read them.
    if (!target.isStage) {
      for (const [name, decl] of decls.vars) {
        if (!target.usage.vars.has(name))
          this.reportUnused(decl, "variable", name);
      }
      for (const [name, decl] of decls.lists) {
        if (!target.usage.lists.has(name))
          this.reportUnused(decl, "list", name);
      }
    }
    for (const [name, fn] of decls.funcs) {
      if (!target.usage.funcs.has(name)) {
        this.report(
          "FX209",
          fn.loc,
          `Function ${JSON.stringify(name)} is never called.`,
          { length: name.length },
        );
      }
      const used = this.paramUsage.get(fn) ?? new Set();
      for (const param of fn.params) {
        if (!used.has(param.name)) {
          this.report(
            "FX207",
            fn.loc,
            `Parameter ${JSON.stringify(param.name)} of ${JSON.stringify(name)} is never used.`,
            { length: name.length },
          );
        }
      }
    }
  }

  /** FX208: stage names that no target reads, after all targets ran. */
  checkGlobalUsage(globals) {
    for (const [name, decl] of globals.vars) {
      if (!this.globalUsage.vars.has(name))
        this.reportUnused(decl, "variable", name);
    }
    for (const [name, decl] of globals.lists) {
      if (!this.globalUsage.lists.has(name))
        this.reportUnused(decl, "list", name);
    }
  }

  reportUnused(decl, kind, name) {
    this.report("FX208", decl.loc, `Unused ${kind} ${JSON.stringify(name)}.`, {
      length: name.length,
    });
  }
}

// ------------------------------------------------------------- suppressions

const DIRECTIVE =
  /^fx-lint-(disable-next-line|disable-file|disable|enable)\b(.*)$/;

/**
 * Read `// fx-lint-*` directives from one source file's comments.
 * @returns {{directives: object[], diagnostics: object[]}}
 */
function collectSuppressions(source, file) {
  const directives = [];
  const diagnostics = [];
  let comments;
  try {
    ({ comments } = tokenizeWithComments(source, file));
  } catch {
    return { directives, diagnostics };
  }
  for (const comment of comments) {
    const body = comment.text
      .replace(/^\/\/+/, "")
      .replace(/^\/\*+/, "")
      .replace(/\*+\/$/, "")
      .trim();
    const match = DIRECTIVE.exec(body);
    if (!match) continue;
    const kind = match[1];
    const rest = match[2].trim();
    let rules = null;
    if (rest) {
      const valid = new Set();
      const invalid = [];
      for (const token of rest.split(/[\s,]+/).filter(Boolean)) {
        const rule = ruleById(token.replace(/[.,;]+$/, ""));
        if (rule) valid.add(rule.id);
        else invalid.push(token);
      }
      if (invalid.length) {
        for (const token of invalid) {
          diagnostics.push({
            ruleId: "FX001",
            severity: RULES.FX001.severity,
            category: RULES.FX001.category,
            message: `Unknown rule ${JSON.stringify(token)} in fx-lint directive.`,
            ...rangeOf(
              { file, line: comment.line, column: comment.column },
              body.length,
            ),
            explanation: RULES.FX001.explanation,
            fixable: false,
          });
        }
      }
      rules = valid;
    }
    directives.push({
      kind,
      line: comment.line,
      column: comment.column,
      length: body.length,
      file,
      rules,
      used: false,
    });
  }
  return { directives, diagnostics };
}

function suppressionFor(directive, diagnostic) {
  if (directive.rules && !directive.rules.has(diagnostic.ruleId)) return false;
  if (directive.kind === "disable-file") return true;
  if (directive.kind === "disable-next-line")
    return diagnostic.line === directive.line + 1;
  return false;
}

/** Fold `disable`/`enable` ranges up to the diagnostic's line. */
function rangeSuppression(directives, diagnostic) {
  let state = false;
  let matched = null;
  for (const directive of directives) {
    if (directive.kind !== "disable" && directive.kind !== "enable") continue;
    if (directive.line > diagnostic.line) continue;
    if (directive.rules && !directive.rules.has(diagnostic.ruleId)) continue;
    state = directive.kind === "disable";
    matched = directive;
  }
  return state ? matched : null;
}

/**
 * Remove suppressed diagnostics and, in strict mode, report suppressions that
 * never matched anything.
 */
function applySuppressions(diagnostics, directivesByFile, { strict }) {
  const remaining = [];
  let suppressed = 0;
  for (const diagnostic of diagnostics) {
    if (META_RULES.has(diagnostic.ruleId) || !diagnostic.file) {
      remaining.push(diagnostic);
      continue;
    }
    const directives = directivesByFile.get(diagnostic.file) ?? [];
    const direct = directives.find((directive) =>
      suppressionFor(directive, diagnostic),
    );
    const ranged = direct ? null : rangeSuppression(directives, diagnostic);
    const match = direct ?? ranged;
    if (match) {
      match.used = true;
      suppressed += 1;
    } else {
      remaining.push(diagnostic);
    }
  }

  if (strict) {
    for (const directives of directivesByFile.values()) {
      for (const directive of directives) {
        if (directive.used) continue;
        if (directive.rules && directive.rules.size === 0) continue;
        remaining.push({
          ruleId: "FX002",
          severity: RULES.FX002.severity,
          category: RULES.FX002.category,
          message: `Unused lint suppression for ${directive.rules ? [...directive.rules].join(", ") : "all rules"}.`,
          ...rangeOf(
            {
              file: directive.file,
              line: directive.line,
              column: directive.column,
            },
            directive.length,
          ),
          explanation: RULES.FX002.explanation,
          fixable: false,
        });
      }
    }
  }
  return { diagnostics: remaining, suppressed };
}

// ---------------------------------------------------------------- public API

/** Deterministic diagnostic order. */
export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort(
    (a, b) =>
      String(a.file ?? "").localeCompare(String(b.file ?? "")) ||
      a.line - b.line ||
      a.column - b.column ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.message.localeCompare(b.message),
  );
}

/**
 * Lint a set of sources with the browser-safe rules.
 *
 * `extraDiagnostics` lets the Node entry point (`src/linter.js`) add
 * filesystem-backed project checks while sharing severity handling,
 * suppressions and ordering.
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
 *   extraDiagnostics?: object[],
 * }} options
 * @returns {{
 *   diagnostics: object[],
 *   summary: {errors: number, warnings: number, suppressed: number, files: number},
 *   severities: Map<string, string>,
 *   sources: Map<string, string>,
 * }}
 */
export function lintSources({
  sources = [],
  config = null,
  configPath = null,
  extensionCatalog = {},
  declaredExtensions = [],
  lintConfig = DEFAULT_LINT,
  strict = false,
  overrides = {},
  extraDiagnostics = [],
} = {}) {
  const severities = resolveRuleSeverities(lintConfig, { strict, overrides });
  const textByFile = new Map(sources.map(({ file, source }) => [file, source]));
  const verifiedExtensions = new Set(
    Object.keys(extensionCatalog)
      .filter((name) => name.includes("."))
      .map((name) => name.slice(0, name.indexOf("."))),
  );
  const analyzer = new Analyzer({
    severities,
    catalog: { ...CATALOG, ...extensionCatalog },
    extensionIds: verifiedExtensions,
    declaredExtensions: new Set(declaredExtensions.map(String)),
    sourceText: (file) => textByFile.get(file) ?? null,
  });

  // Parse everything up front; syntax errors are reported as FX000 and the
  // file is excluded from the AST rules.
  const parsed = [];
  for (const { file, source } of sources) {
    try {
      parsed.push({ file, ast: parse(source, file) });
    } catch (error) {
      const loc =
        error instanceof ParseError
          ? {
              file: error.file ?? file,
              line: error.line ?? 1,
              column: error.column ?? 1,
            }
          : { file, line: 1, column: 1 };
      analyzer.report("FX000", loc, error.message, { length: 1 });
    }
  }

  // Partial sprites are resolved by the project merge, which throws when the
  // feature is off or a base declaration is missing. Report those first.
  const partialSprites = Boolean(config?.fx?.partialSprites);
  let partialBlocked = false;
  if (!partialSprites) {
    for (const { ast } of parsed) {
      for (const sprite of ast.sprites) {
        if (!sprite.partial) continue;
        partialBlocked = true;
        analyzer.report(
          "FX803",
          sprite.loc,
          `Partial sprite ${JSON.stringify(sprite.name)} needs "fx.partialSprites: true" in ${configPath ? baseName(configPath) : "fx.yml"}.`,
          { length: sprite.name.length },
        );
      }
    }
  }
  const groups = new Map();
  for (const { ast } of parsed) {
    for (const sprite of ast.sprites) {
      const group = groups.get(sprite.name) ?? { base: false, fragment: null };
      if (sprite.partial) group.fragment ??= sprite;
      else group.base = true;
      groups.set(sprite.name, group);
    }
  }
  for (const [name, group] of groups) {
    if (group.base || !group.fragment) continue;
    analyzer.report(
      "FX804",
      group.fragment.loc,
      `Partial sprite ${JSON.stringify(name)} has no plain \`sprite ${JSON.stringify(name)} { }\` declaration.`,
      { length: name.length },
    );
  }

  let program = null;
  if (!partialBlocked) {
    try {
      program = mergePrograms(
        parsed.map(({ file, ast }) => ({ ast, file })),
        { partialSprites },
      );
    } catch (error) {
      const loc =
        error instanceof ParseError
          ? { file: error.file, line: error.line, column: error.column }
          : { file: null, line: 1, column: 1 };
      analyzer.report("FX000", loc, error.message, { length: 1 });
    }
  }
  if (program) analyzer.analyzeProgram(program);
  else for (const { ast } of parsed) analyzer.analyzeProgram(ast);

  // Diagnostics from filesystem-backed project checks (assets, fx.lock).
  for (const diagnostic of extraDiagnostics) {
    const rule = RULES[diagnostic.ruleId];
    if (!rule || !analyzer.enabled(diagnostic.ruleId)) continue;
    analyzer.diagnostics.push({
      ruleId: rule.id,
      severity: severities.get(rule.id) ?? rule.severity,
      category: rule.category,
      message: diagnostic.message,
      ...rangeOf(
        {
          file: diagnostic.file ?? null,
          line: diagnostic.line ?? 1,
          column: diagnostic.column ?? 1,
        },
        diagnostic.length ?? 1,
      ),
      explanation: rule.explanation,
      fixable: Boolean(rule.fixable),
    });
  }

  // Suppressions are per file, so parse each file's comments after analysis.
  const directivesByFile = new Map();
  for (const { file, source } of sources) {
    const { directives, diagnostics } = collectSuppressions(source, file);
    directivesByFile.set(file, directives);
    analyzer.diagnostics.push(...diagnostics);
  }

  const { diagnostics, suppressed } = applySuppressions(
    analyzer.diagnostics,
    directivesByFile,
    { strict },
  );
  const sorted = sortDiagnostics(diagnostics);
  const summary = {
    errors: sorted.filter((entry) => entry.severity === "error").length,
    warnings: sorted.filter((entry) => entry.severity === "warning").length,
    suppressed,
    files: sources.length,
  };
  return { diagnostics: sorted, summary, severities, sources: textByFile };
}

/**
 * Apply safe, explicit fixes. Today only FX204 (implicit variable) is fixable:
 * the declaration is inserted just inside the target's opening brace.
 *
 * @param {Array<{file: string, source: string}>} sources
 * @param {object[]} diagnostics
 * @returns {{sources: Map<string, string>, files: string[], fixed: number}}
 */
export function applyFixes(sources, diagnostics) {
  const textByFile = new Map(sources.map(({ file, source }) => [file, source]));
  const inserts = new Map(); // file -> Map<line, Set<text>>
  let fixed = 0;
  for (const diagnostic of diagnostics) {
    if (!diagnostic.fix || diagnostic.fix.kind !== "declare-variable") continue;
    if (!diagnostic.file || !textByFile.has(diagnostic.file)) continue;
    // A target in another file has no brace to insert into; never apply a fix
    // to a file other than the one that reported it.
    if (diagnostic.fix.file !== diagnostic.file) continue;
    const byLine = inserts.get(diagnostic.file) ?? new Map();
    const line = diagnostic.fix.targetLine ?? 1;
    const names = byLine.get(line) ?? new Set();
    const indent = diagnostic.fix.indent ?? "    ";
    names.add(`${indent}let ${diagnostic.fix.name} = 0;`);
    byLine.set(line, names);
    inserts.set(diagnostic.file, byLine);
    fixed += 1;
  }

  const files = [];
  for (const [file, byLine] of inserts) {
    const lines = textByFile.get(file).split(/\r?\n/);
    const ordered = [...byLine.entries()].sort((a, b) => b[0] - a[0]);
    for (const [line, declarations] of ordered) {
      lines.splice(line, 0, ...declarations);
    }
    textByFile.set(file, lines.join("\n"));
    files.push(file);
  }
  return { sources: textByFile, files, fixed };
}
