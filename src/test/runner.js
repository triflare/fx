/**
 * Test runner.
 *
 * Discovers test files, builds the project once, then runs each test in a
 * fresh headless PenguinMod VM. Actions drive the runtime; assertions read
 * project state through explicit `state.*` queries. The runner never prints:
 * it emits structured events for the terminal, JSON, JUnit, and editor
 * reporters.
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "../build.js";
import { loadProject } from "../vm.js";
import { loadConfigFrom, DEFAULT_TESTS } from "../config.js";
import { loadExtensions } from "../extensions.js";
import { loadFeatureExtensions } from "../features.js";
import { loadVendorExtensions } from "../vendor.js";
import { productVersion } from "../brand.js";
import { discoverTests } from "./discover.js";
import { parseTests } from "./parse.js";

/** Exit codes promised by `fx test`. */
export const TEST_EXIT = {
  OK: 0,
  FAILED: 1,
  ERROR: 2,
  INTERRUPTED: 3,
  USAGE: 4,
};

/** A configuration or test-language problem. */
export class TestError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "TestError";
    this.exitCode = options.exitCode ?? TEST_EXIT.ERROR;
    this.hint = options.hint;
    this.diagnostics = options.diagnostics ?? [];
  }
}

class AssertionFailure extends Error {
  constructor(details) {
    super(details.message);
    this.name = details.name ?? "AssertionError";
    this.details = { name: this.name, ...details };
  }
}

class TimeoutFailure extends Error {
  constructor(timeout) {
    super(`Test timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

/**
 * Deterministic pseudo-random source for a run.
 * @param {number} seed
 * @returns {() => number} values in `[0, 1)`
 */
function mulberry32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Source location of an AST node, defaulting unknown fields to null. */
function locOf(node) {
  const loc = node?.loc ?? {};
  return {
    file: loc.file ?? null,
    line: loc.line ?? null,
    column: loc.column ?? null,
  };
}

/** Whether a value is, or is entirely made of, a finite number. */
function isNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return false;
    const number = Number(trimmed);
    return !Number.isNaN(number);
  }
  return false;
}

/** Scratch-style truthiness: `"0"` and `""` are false. */
function truthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string")
    return isNumeric(value) ? Number(value) !== 0 : value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/** Compare like the VM's `Cast.compare`: numeric when both sides are. */
function compareValues(left, right) {
  if (isNumeric(left) && isNumeric(right)) {
    const a = Number(left);
    const b = Number(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = String(left).toLowerCase();
  const b = String(right).toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Render a value for an assertion message. */
function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/** Find a project variable by name and variable type, stage first. */
function findVariable(vm, name, type) {
  const stage = vm.runtime.getTargetForStage?.();
  const targets = [stage, ...vm.runtime.targets.filter((t) => !t.isStage)];
  for (const target of targets) {
    if (!target) continue;
    for (const variable of Object.values(target.variables ?? {})) {
      if (variable.name === name && (variable.type ?? "") === type)
        return variable;
    }
  }
  return null;
}

/** Capture the mutable state `reset()` restores between tests. */
function snapshotVm(vm) {
  return vm.runtime.targets.map((target) => ({
    id: target.id,
    variables: Object.fromEntries(
      Object.entries(target.variables ?? {}).map(([id, variable]) => [
        id,
        Array.isArray(variable.value) ? [...variable.value] : variable.value,
      ]),
    ),
    x: target.x,
    y: target.y,
    direction: target.direction,
    visible: target.visible,
    size: target.size,
    currentCostume: target.currentCostume,
  }));
}

/** Restore a snapshot taken by {@link snapshotVm}. */
function restoreVm(vm, snapshot) {
  vm.stopAll();
  vm.runtime.threads = [];
  for (const saved of snapshot) {
    const target = vm.runtime.getTargetById(saved.id);
    if (!target) continue;
    for (const [id, value] of Object.entries(saved.variables)) {
      if (target.variables?.[id])
        target.variables[id].value = Array.isArray(value) ? [...value] : value;
    }
    target.x = saved.x;
    target.y = saved.y;
    target.direction = saved.direction;
    target.visible = saved.visible;
    target.size = saved.size;
    target.currentCostume = saved.currentCostume;
  }
}

// ------------------------------------------------------------------ interpreter

/** Execution state for one test: bindings, VM, clocks and captures. */
function createScope({ vm, config, seed, capture, deadline, warnings }) {
  return {
    vm,
    config,
    seed,
    capture,
    deadline,
    warnings,
    progress: { ticks: 0 },
    vars: new Map(),
    functions: new Map(),
    broadcasts: new Set(),
  };
}

/** Abort the test once its wall-clock budget is spent. */
function checkDeadline(scope) {
  if (performance.now() > scope.deadline)
    throw new TimeoutFailure(scope.config.timeout);
}

/** Scope for a function call or block: new cells, shared outer bindings. */
function childScope(scope) {
  // Copy bindings while sharing their cells; declarations and parameters get
  // new cells, while assignments to existing test variables reach the caller.
  return { ...scope, vars: new Map(scope.vars) };
}

/** Evaluate a test-language expression. */
function evaluate(node, scope) {
  switch (node.type) {
    case "Number":
    case "String":
    case "Boolean":
      return node.value;
    case "ArrayLiteral":
      return node.items.map((item) => evaluate(item, scope));
    case "Identifier": {
      if (scope.vars.has(node.name)) return scope.vars.get(node.name).value;
      throw new TestError(
        `Unknown name ${JSON.stringify(node.name)} in test expression`,
        { diagnostics: [locOf(node)] },
      );
    }
    case "Member": {
      const object = evaluate(node.object, scope);
      if (object == null || !(node.property in Object(object)))
        throw new TestError(
          `Value has no property ${JSON.stringify(node.property)}`,
          { diagnostics: [locOf(node)] },
        );
      return object[node.property];
    }
    case "Unary": {
      const value = evaluate(node.operand, scope);
      return node.op === "not" ? !truthy(value) : -Number(value);
    }
    case "Binary":
      return evaluateBinary(node, scope);
    case "Call":
      return evaluateCall(node, scope);
    default:
      throw new TestError(`Unsupported expression ${node.type} in a test`, {
        diagnostics: [locOf(node)],
      });
  }
}

/** Evaluate a binary operator with short-circuiting for `and`/`or`. */
function evaluateBinary(node, scope) {
  if (node.op === "and")
    return (
      truthy(evaluate(node.left, scope)) && truthy(evaluate(node.right, scope))
    );
  if (node.op === "or")
    return (
      truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope))
    );

  const left = evaluate(node.left, scope);
  const right = evaluate(node.right, scope);
  switch (node.op) {
    case "==":
      return compareValues(left, right) === 0;
    case "!=":
      return compareValues(left, right) !== 0;
    case "<":
      return compareValues(left, right) < 0;
    case "<=":
      return compareValues(left, right) <= 0;
    case ">":
      return compareValues(left, right) > 0;
    case ">=":
      return compareValues(left, right) >= 0;
    case "+":
      return isNumeric(left) && isNumeric(right)
        ? Number(left) + Number(right)
        : String(left) + String(right);
    case "-":
      return Number(left) - Number(right);
    case "*":
      return Number(left) * Number(right);
    case "/":
      return Number(right) === 0 ? Infinity : Number(left) / Number(right);
    case "%": {
      const divisor = Number(right);
      if (divisor === 0) return NaN;
      const result = Number(left) % divisor;
      return result / divisor < 0 ? result + divisor : result;
    }
    default:
      throw new TestError(`Unsupported operator ${node.op} in a test`, {
        diagnostics: [locOf(node)],
      });
  }
}

/** Read a required argument from a call, failing with its location. */
function argument(node, index) {
  const value = node.args[index];
  if (value === undefined)
    throw new TestError(`Missing argument ${index + 1} for ${node.name}`, {
      diagnostics: [locOf(node)],
    });
  return value;
}

/** Evaluate a test helper call, `state.*` query or project block call. */
function evaluateCall(node, scope) {
  const segments = node.segments ?? String(node.name).split(".");
  if (segments[0] === "state")
    return stateQuery(segments.slice(1), node, scope);

  const fn = scope.functions.get(node.name);
  if (!fn) return callProjectProcedure(node, scope);
  const local = childScope(scope);
  fn.params.forEach((param, index) => {
    local.vars.set(param.name, {
      value: node.args[index] ? evaluate(node.args[index], scope) : 0,
    });
  });
  try {
    executeStatements(fn.body, local);
  } catch (signal) {
    if (signal instanceof ReturnSignal) return signal.value;
    throw signal;
  }
  return 0;
}

/** Stage first, then sprites: where a project block can be declared. */
function procedureTargets(vm) {
  const stage = vm.runtime.getTargetForStage?.();
  return [
    stage,
    ...vm.runtime.targets.filter((target) => !target.isStage),
  ].filter(Boolean);
}

/**
 * Input block id. Compiled JSON stores `[type, id, ...]`; a VM-loaded project
 * stores `{name, block, shadow}`.
 */
function inputBlockId(input) {
  if (Array.isArray(input)) return input[1] ?? null;
  if (input && typeof input === "object")
    return input.block ?? input.shadow ?? null;
  return null;
}

/** A text primitive block in the shape a VM-loaded project uses. */
function textBlock(id, value, parent) {
  return {
    id,
    opcode: "text",
    next: null,
    parent,
    inputs: {},
    fields: { TEXT: { name: "TEXT", value: String(value ?? "") } },
    shadow: true,
    topLevel: false,
  };
}

/** Find a custom block definition on one target by name and argument count. */
function findProcedure(target, name, arity) {
  const blocks = target?.blocks?._blocks ?? {};
  for (const block of Object.values(blocks)) {
    if (
      block.opcode !== "procedures_definition" &&
      block.opcode !== "procedures_definition_return"
    )
      continue;
    const protoId = inputBlockId(block.inputs?.custom_block);
    const proto = typeof protoId === "string" ? blocks[protoId] : null;
    const mutation = proto?.mutation;
    if (!mutation) continue;
    let argIds;
    try {
      argIds = JSON.parse(mutation.argumentids ?? "[]");
    } catch {
      argIds = [];
    }
    if (argIds.length !== arity) continue;
    const proccode = String(mutation.proccode ?? "");
    if (proccode !== name && !proccode.startsWith(`${name} `)) continue;
    return {
      proccode,
      argIds,
      returns:
        block.opcode === "procedures_definition_return" ||
        mutation.returns === "true" ||
        mutation.returns === true,
    };
  }
  return null;
}

/** Names of the project's custom blocks, for error messages. */
function availableProcedures(vm) {
  const names = [];
  for (const target of procedureTargets(vm)) {
    const blocks = target.blocks?._blocks ?? {};
    for (const block of Object.values(blocks)) {
      if (
        block.opcode !== "procedures_definition" &&
        block.opcode !== "procedures_definition_return"
      )
        continue;
      const protoId = inputBlockId(block.inputs?.custom_block);
      const proto = typeof protoId === "string" ? blocks[protoId] : null;
      const proccode = proto?.mutation?.proccode;
      if (!proccode) continue;
      names.push(
        target.isStage ? String(proccode) : `${target.getName()}.${proccode}`,
      );
    }
  }
  return [...new Set(names)].sort();
}

/**
 * Resolve `score()` or `Player.score()` to a target and its definition.
 * A bare name must match exactly one target. Tests do not receive implicit
 * receivers, so ambiguity is an error rather than a guess.
 */
function resolveProcedure(node, scope) {
  const segments = node.segments ?? String(node.name).split(".");
  const name = segments.length > 1 ? segments.slice(1).join(".") : segments[0];
  const arity = node.args.length;

  if (segments.length > 1) {
    const wanted = segments[0];
    const target = procedureTargets(scope.vm).find(
      (candidate) =>
        (candidate.isStage && /^stage$/i.test(wanted)) ||
        candidate.getName?.() === wanted,
    );
    if (!target)
      throw new TestError(
        `No sprite named ${JSON.stringify(wanted)} in the project`,
        { diagnostics: [locOf(node)] },
      );
    const procedure = findProcedure(target, name, arity);
    if (!procedure)
      throw new TestError(
        `No block named ${JSON.stringify(name)} with ${arity} argument(s) in ${wanted}`,
        { diagnostics: [locOf(node)] },
      );
    return { target, procedure };
  }

  const found = [];
  for (const target of procedureTargets(scope.vm)) {
    const procedure = findProcedure(target, name, arity);
    if (procedure) found.push({ target, procedure });
  }
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    const owners = found.map(({ target }) =>
      target.isStage ? "Stage" : target.getName(),
    );
    throw new TestError(
      `Block ${JSON.stringify(name)} is declared by more than one target (${owners.join(
        ", ",
      )}); qualify it with the sprite name, as in ${owners[0]}.${name}(...)`,
      { diagnostics: [locOf(node)] },
    );
  }

  const available = availableProcedures(scope.vm);
  throw new TestError(
    `Unknown test action or project block ${JSON.stringify(node.name)}` +
      (available.length ? `. Available blocks: ${available.join(", ")}` : ""),
    { diagnostics: [locOf(node)] },
  );
}

/**
 * Call a project custom block and wait for it to finish.
 *
 * A returning block is wrapped in a temporary `set variable` script so its
 * value can be read from the VM, then the synthetic blocks and variable are
 * removed again.
 */
function callProjectProcedure(node, scope) {
  const { target, procedure } = resolveProcedure(node, scope);
  const { vm } = scope;
  const blocks = target.blocks;
  if (!blocks?._blocks)
    throw new TestError(
      "The project target has no blocks to call; rebuild the project",
      { diagnostics: [locOf(node)] },
    );
  if (typeof vm.runtime._pushThread !== "function")
    throw new TestError(
      "This PenguinMod VM build cannot run project blocks from tests",
      { diagnostics: [locOf(node)] },
    );

  const values = node.args.map((arg) => evaluate(arg, scope));
  scope.progress.procedureCalls = (scope.progress.procedureCalls ?? 0) + 1;
  const stamp = `${String(target.id ?? "target").replace(/[^A-Za-z0-9_]/g, "_")}_fxtest${scope.progress.procedureCalls}_${scope.progress.ticks}`;
  const callId = `${stamp}_call`;
  const synthetic = [callId];
  const inputs = {};
  procedure.argIds.forEach((argId, index) => {
    const argBlockId = `${stamp}_arg${index}`;
    synthetic.push(argBlockId);
    blocks._blocks[argBlockId] = textBlock(argBlockId, values[index], callId);
    inputs[argId] = { name: argId, block: argBlockId, shadow: argBlockId };
  });
  blocks._blocks[callId] = {
    id: callId,
    opcode: "procedures_call",
    next: null,
    parent: null,
    inputs,
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
    mutation: {
      tagName: "mutation",
      children: [],
      proccode: procedure.proccode,
      argumentids: JSON.stringify(procedure.argIds),
      warp: "false",
      ...(procedure.returns ? { returns: "true" } : {}),
    },
  };

  let setId = null;
  let varId = null;
  if (procedure.returns) {
    varId = `${stamp}_var`;
    const varName = `__fxTestReturn${scope.progress.procedureCalls}`;
    target.variables[varId] = {
      id: varId,
      name: varName,
      type: "",
      value: 0,
      isCloud: false,
    };
    setId = `${stamp}_set`;
    const valueShadowId = `${stamp}_value`;
    synthetic.push(setId, valueShadowId);
    blocks._blocks[valueShadowId] = textBlock(valueShadowId, "", setId);
    blocks._blocks[setId] = {
      id: setId,
      opcode: "data_setvariableto",
      next: null,
      parent: null,
      inputs: {
        VALUE: { name: "VALUE", block: callId, shadow: valueShadowId },
      },
      fields: {
        VARIABLE: {
          name: "VARIABLE",
          value: varName,
          id: varId,
          variableType: "",
        },
      },
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    };
    blocks._blocks[callId].parent = setId;
  }

  try {
    const thread = vm.runtime._pushThread(setId ?? callId, target);
    if (!thread)
      throw new TestError(
        `Could not start ${JSON.stringify(node.name)} in the VM`,
        { diagnostics: [locOf(node)] },
      );
    while (vm.runtime.threads.includes(thread)) stepTicks(scope, 1);
    if (!procedure.returns) return 0;
    return target.variables[varId]?.value ?? 0;
  } finally {
    for (const id of synthetic) delete blocks._blocks[id];
    if (varId) delete target.variables[varId];
  }
}

/** Resolve a `state.*` assertion query against the VM. */
function stateQuery(segments, node, scope) {
  const [query, property] = segments;
  const args = node.args.map((arg) => evaluate(arg, scope));
  const { vm } = scope;

  if (segments.length > 2)
    throw new TestError(`Unknown state query state.${segments.join(".")}`, {
      diagnostics: [locOf(node)],
    });

  switch (query) {
    case "variable": {
      const variable = findVariable(vm, String(args[0]), "");
      if (!variable)
        throw new TestError(
          `No variable named ${JSON.stringify(String(args[0]))} in the project`,
          { diagnostics: [locOf(node)] },
        );
      return variable.value;
    }
    case "list": {
      const variable = findVariable(vm, String(args[0]), "list");
      if (!variable)
        throw new TestError(
          `No list named ${JSON.stringify(String(args[0]))} in the project`,
          { diagnostics: [locOf(node)] },
        );
      const items = Array.isArray(variable.value) ? [...variable.value] : [];
      if (!property)
        return {
          length: items.length,
          items,
          itemAt: (index) => items[Number(index) - 1],
        };
      if (property === "length") return items.length;
      if (property === "items") return items;
      throw new TestError(`Unknown list property ${JSON.stringify(property)}`, {
        diagnostics: [locOf(node)],
      });
    }
    case "sprite": {
      const name = String(args[0]);
      const target = vm.runtime.getSpriteTargetByName(name);
      if (!target)
        throw new TestError(
          `No sprite named ${JSON.stringify(name)} in the project`,
          {
            diagnostics: [locOf(node)],
          },
        );
      const sprite = {
        name,
        x: target.x,
        y: target.y,
        direction: target.direction,
        visible: target.visible,
        size: target.size,
        costume: target.getCostumes?.()[target.currentCostume]?.name ?? null,
      };
      if (!property) return sprite;
      if (!(property in sprite))
        throw new TestError(
          `Unknown sprite property ${JSON.stringify(property)}`,
          {
            diagnostics: [locOf(node)],
          },
        );
      return sprite[property];
    }
    case "broadcasted":
      return scope.broadcasts.has(String(args[0]));
    case "errors":
      return [...scope.capture.errors];
    case "ticks":
      return scope.progress.ticks;
    default:
      throw new TestError(`Unknown state query state.${segments.join(".")}`, {
        diagnostics: [locOf(node)],
      });
  }
}

/** Run a list of test statements in order. */
function executeStatements(statements, scope) {
  for (const statement of statements) {
    checkDeadline(scope);
    executeStatement(statement, scope);
  }
}

/** Run one statement node. */
function executeStatement(node, scope) {
  switch (node.type) {
    case "VarDecl":
      scope.vars.set(node.name, {
        value: node.init ? evaluate(node.init, scope) : 0,
      });
      return;
    case "FunctionDecl":
      scope.functions.set(node.name, node);
      return;
    case "Assign": {
      if (!scope.vars.has(node.name))
        throw new TestError(
          `Unknown variable ${JSON.stringify(node.name)} in test`,
          { diagnostics: [locOf(node)] },
        );
      const previous = scope.vars.get(node.name).value;
      const value = evaluate(node.value, scope);
      const next =
        node.op === "="
          ? value
          : node.op === "+="
            ? isNumeric(previous) && isNumeric(value)
              ? Number(previous) + Number(value)
              : String(previous) + String(value)
            : node.op === "-="
              ? Number(previous) - Number(value)
              : node.op === "*="
                ? Number(previous) * Number(value)
                : Number(previous) / Number(value);
      scope.vars.get(node.name).value = next;
      return;
    }
    case "If":
      if (truthy(evaluate(node.cond, scope)))
        executeStatements(node.then, scope);
      else if (node.else) executeStatements(node.else, scope);
      return;
    case "Repeat": {
      const count = Math.round(Number(evaluate(node.count, scope)));
      for (let index = 0; index < count; index += 1) {
        checkDeadline(scope);
        executeStatements(node.body, scope);
      }
      return;
    }
    case "While":
      while (truthy(evaluate(node.cond, scope))) {
        checkDeadline(scope);
        executeStatements(node.body, scope);
      }
      return;
    case "Forever":
      for (;;) {
        checkDeadline(scope);
        executeStatements(node.body, scope);
      }
    case "Return":
      throw new ReturnSignal(node.value ? evaluate(node.value, scope) : 0);
    case "Expect":
      assertExpectation(node, scope);
      return;
    case "BlockCall":
      executeAction(node, scope);
      return;
    default:
      throw new TestError(`Unsupported statement ${node.type} in a test`, {
        diagnostics: [locOf(node)],
      });
  }
}

const COMPARISONS = {
  "==": "to equal",
  "!=": "not to equal",
  ">": "to be greater than",
  ">=": "to be at least",
  "<": "to be less than",
  "<=": "to be at most",
};

/** Throw a detailed `AssertionFailure` when an `expect` is not truthy. */
function assertExpectation(node, scope) {
  if (truthy(evaluate(node.value, scope))) return;

  let message = "expected a truthy value";
  let expected;
  let received;
  if (node.value.type === "Binary" && COMPARISONS[node.value.op]) {
    received = evaluate(node.value.left, scope);
    expected = evaluate(node.value.right, scope);
    message = `expected ${formatValue(received)} ${COMPARISONS[node.value.op]} ${formatValue(expected)}`;
  }
  if (node.message) message = `${node.message}: ${message}`;

  throw new AssertionFailure({
    message,
    expected,
    received,
    ...locOf(node),
  });
}

/**
 * Advance simulated time by `count` frames.
 *
 * `runtime._step()` reads `currentMSecs`, so advancing it directly keeps
 * waits, timers and the tick counter deterministic and independent of the
 * real clock.
 */
function stepTicks(scope, count) {
  for (let index = 0; index < count; index += 1) {
    checkDeadline(scope);
    try {
      scope.vm.runtime.currentMSecs += 1000 / scope.config.ticksPerSecond;
      scope.vm.runtime._step();
    } catch (error) {
      scope.capture.errors.push(error?.message ?? String(error));
      if (scope.config.failOnRuntimeError) throw error;
    }
    scope.progress.ticks += 1;
  }
}

/** Run a built-in test action, falling back to a project block call. */
function executeAction(node, scope) {
  const name = (node.segments ?? [node.name]).join(".");
  const arg = (index) => evaluate(argument(node, index), scope);
  const { vm } = scope;

  switch (name) {
    case "reset": {
      restoreVm(vm, scope.initial);
      scope.progress.ticks = 0;
      scope.broadcasts.clear();
      scope.capture.errors.length = 0;
      return;
    }
    case "start":
      vm.greenFlag();
      return;
    case "step":
      stepTicks(scope, node.args.length ? Math.round(Number(arg(0))) : 1);
      return;
    case "broadcast": {
      const message = String(arg(0));
      scope.broadcasts.add(message);
      vm.runtime.startHats("event_whenbroadcastreceived", {
        BROADCAST_OPTION: message,
      });
      return;
    }
    case "broadcastAndWait": {
      const message = String(arg(0));
      scope.broadcasts.add(message);
      vm.runtime.startHats("event_whenbroadcastreceived", {
        BROADCAST_OPTION: message,
      });
      while (vm.runtime.threads.length > 0) stepTicks(scope, 1);
      return;
    }
    case "click": {
      const target = node.args.length
        ? vm.runtime.getSpriteTargetByName(String(arg(0)))
        : null;
      if (node.args.length && !target)
        throw new TestError(
          `No sprite named ${JSON.stringify(String(arg(0)))} to click`,
          { diagnostics: [locOf(node)] },
        );
      if (!target) {
        vm.runtime.startHats("event_whenstageclicked");
        for (const sprite of vm.runtime.targets.filter((item) => !item.isStage))
          vm.runtime.startHats("event_whenthisspriteclicked", null, sprite);
      } else if (target.isStage) {
        vm.runtime.startHats("event_whenstageclicked", null, target);
      } else {
        vm.runtime.startHats("event_whenthisspriteclicked", null, target);
      }
      return;
    }
    case "keyDown":
    case "keyUp":
      vm.postIOData("keyboard", {
        key: String(arg(0)),
        isDown: name === "keyDown",
      });
      return;
    default:
      // Anything that is not a built-in test action may be a project block.
      callProjectProcedure(node, scope);
      return;
  }
}

// ---------------------------------------------------------------- run one test

/** Trim a failure result to the fields a reporter needs. */
function toError(result) {
  return {
    name: result.name,
    message: result.message,
    file: result.file,
    line: result.line,
    column: result.column,
    expected: result.expected,
    received: result.received,
  };
}

/**
 * Run one test in a fresh VM and return its outcome.
 * @returns {Promise<object>} status, duration, ticks and any failure
 */
async function runOneTest({ test, helpers, sb3, config, seed }) {
  const started = performance.now();
  const vm = await loadProject(sb3);
  vm.runtime.currentStepTime = 1000 / config.ticksPerSecond;
  // The sequencer refreshes this clock each frame; keep it on simulated time.
  vm.runtime.updateCurrentMSecs = () => {};

  const capture = { errors: [], warnings: [] };
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalRandom = Math.random;
  const runtime = vm.runtime;
  const compileErrorEvent =
    runtime.constructor?.COMPILE_ERROR ?? "COMPILE_ERROR";
  const onCompileError = (_target, error) =>
    capture.errors.push(error?.message ?? String(error));
  runtime.on?.(compileErrorEvent, onCompileError);

  console.error = (...args) => capture.errors.push(args.map(String).join(" "));
  console.warn = (...args) => capture.warnings.push(args.map(String).join(" "));
  Math.random = mulberry32(seed);

  const scope = createScope({
    vm,
    config,
    seed,
    capture,
    deadline: started + config.timeout,
    warnings: capture.warnings,
  });
  scope.initial = snapshotVm(vm);

  let status = "passed";
  let failure = null;
  try {
    executeStatements(helpers, scope);
    executeStatements(test.body, scope);
    if (config.failOnRuntimeError && capture.errors.length > 0)
      throw new AssertionFailure({
        name: "RuntimeError",
        message: `runtime error: ${capture.errors[0]}`,
        ...locOf(test),
      });
  } catch (error) {
    status = "failed";
    if (error instanceof AssertionFailure) failure = toError(error.details);
    else if (error instanceof TimeoutFailure)
      failure = {
        name: "TimeoutError",
        message: error.message,
        ...locOf(test),
      };
    else if (error instanceof TestError)
      failure = {
        name: "TestLanguageError",
        message: error.message,
        ...(error.diagnostics[0] ?? locOf(test)),
      };
    else
      failure = {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        ...locOf(test),
      };
  } finally {
    runtime.off?.(compileErrorEvent, onCompileError);
    console.error = originalError;
    console.warn = originalWarn;
    Math.random = originalRandom;
    try {
      vm.stopAll();
    } catch {
      // A VM that failed to load has nothing to stop.
    }
  }

  return {
    name: test.name,
    status,
    durationMs: Math.round(performance.now() - started),
    ticks: scope.progress.ticks,
    seed,
    error: failure,
  };
}

// ---------------------------------------------------------------------- driver

/** Load vendored, feature and legacy extensions into one catalog. */
async function loadCatalog({ configDir, loaded }) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  if (loaded.vendor?.length) {
    const vendored = await loadVendorExtensions({ configDir, config: loaded });
    Object.assign(catalog, vendored.catalog);
    Object.assign(extensionUrls, vendored.extensionUrls);
    warnings.push(...vendored.warnings);
  }
  if (loaded.features?.length) {
    const features = await loadFeatureExtensions({ configDir, config: loaded });
    Object.assign(catalog, features.catalog);
    Object.assign(extensionUrls, features.extensionUrls);
    warnings.push(...features.warnings);
  }
  if (loaded.project?.extensions?.length) {
    const legacy = await loadExtensions(loaded.project.extensions, {
      baseDir: configDir,
      expectUnsandboxed: loaded.project.unsandboxed,
      reportUnmatchedUnsandboxed: false,
    });
    Object.assign(catalog, legacy.catalog);
    Object.assign(extensionUrls, legacy.extensionUrls);
    warnings.push(...legacy.warnings);
  }
  return { catalog, extensionUrls, warnings };
}

/** One-line description of a failure, with its source location. */
function describeFailure(error) {
  if (!error) return "";
  const where =
    error.file && error.line
      ? `${error.file}:${error.line}:${error.column ?? 0}`
      : (error.file ?? "");
  const head = `${error.name}: ${error.message}`;
  return where ? `${head}\n ${where}` : head;
}

/**
 * Run project tests.
 *
 * @param {object} [options]
 * @param {string} [options.dir] project directory
 * @param {string[]} [options.files] explicit test files, relative to `cwd`
 * @param {string} [options.cwd] base for explicit files
 * @param {string} [options.filter] substring matched against file and test names
 * @param {object} [options.loaded] preloaded project config
 * @param {Record<string, object>} [options.catalog]
 * @param {Record<string, string>} [options.extensionUrls]
 * @param {number} [options.seed]
 * @param {number} [options.timeout]
 * @param {number} [options.ticksPerSecond]
 * @param {boolean} [options.failOnRuntimeError]
 * @param {(event: object) => void} [options.onEvent]
 * @returns {Promise<object>}
 */
export async function runTests({
  dir = process.cwd(),
  files,
  cwd = process.cwd(),
  filter = "",
  loaded: provided,
  catalog,
  extensionUrls,
  seed,
  timeout,
  ticksPerSecond,
  failOnRuntimeError,
  onEvent = () => {},
} = {}) {
  const started = performance.now();
  const startDate = new Date();
  const root = path.resolve(dir);
  const loaded = provided ?? loadConfigFrom(root);
  const configDir = loaded.path ? path.dirname(loaded.path) : root;
  const settings = loaded.fx?.tests;

  if (!settings)
    throw new TestError("Testing is disabled in this project.", {
      exitCode: TEST_EXIT.ERROR,
      hint: 'run "fx feature tests enable" to turn testing on',
    });

  const config = {
    ...DEFAULT_TESTS,
    ...settings,
    seed: seed ?? settings.seed ?? DEFAULT_TESTS.seed,
    timeout: timeout ?? settings.timeout ?? DEFAULT_TESTS.timeout,
    ticksPerSecond:
      ticksPerSecond ?? settings.ticksPerSecond ?? DEFAULT_TESTS.ticksPerSecond,
    failOnRuntimeError:
      failOnRuntimeError ??
      settings.failOnRuntimeError ??
      DEFAULT_TESTS.failOnRuntimeError,
  };

  const discovered = files?.length
    ? files.map((file) => {
        const absolute = path.resolve(cwd, file);
        return {
          file: absolute,
          relative: path.relative(root, absolute).split(path.sep).join("/"),
        };
      })
    : discoverTests({ dir: root, pattern: settings.pattern });

  const result = {
    dir: root,
    seed: config.seed,
    version: productVersion(),
    startTime: startDate.toISOString(),
    durationMs: 0,
    files: [],
    diagnostics: [],
    counts: {
      files: discovered.length,
      passedFiles: 0,
      failedFiles: 0,
      tests: 0,
      passed: 0,
      failed: 0,
      pending: 0,
    },
    ok: false,
    exitCode: TEST_EXIT.OK,
  };

  onEvent({
    event: "run-start",
    dir: root,
    seed: config.seed,
    version: result.version,
  });

  if (discovered.length === 0) {
    result.diagnostics.push({
      file: null,
      message: `No test files matched ${JSON.stringify(settings.pattern)} under ${root}`,
    });
    result.exitCode = TEST_EXIT.ERROR;
    onEvent({ event: "diagnostic", ...result.diagnostics[0] });
    result.durationMs = Math.round(performance.now() - started);
    onEvent({ event: "run-end", result });
    return result;
  }

  const parsed = parseTests(
    discovered.map((entry) => ({
      file: entry.relative,
      source: fs.readFileSync(entry.file, "utf8"),
    })),
  );
  if (parsed.diagnostics.length > 0) {
    result.diagnostics.push(...parsed.diagnostics);
    for (const diagnostic of parsed.diagnostics)
      onEvent({ event: "diagnostic", ...diagnostic });
    result.exitCode = TEST_EXIT.ERROR;
    result.durationMs = Math.round(performance.now() - started);
    onEvent({ event: "run-end", result });
    return result;
  }

  let extensions = { catalog, extensionUrls, warnings: [] };
  if (!catalog) extensions = await loadCatalog({ configDir, loaded });

  let built;
  try {
    built = build({
      dir: root,
      projectConfig: loaded.project,
      fxConfig: loaded.fx,
      catalog: extensions.catalog,
      extensionUrls: extensions.extensionUrls,
      useConfigFile: false,
      testPattern: settings.pattern,
    });
  } catch (error) {
    result.diagnostics.push({
      file: error.file ?? null,
      line: error.line ?? null,
      column: error.column ?? null,
      message: error.message,
    });
    onEvent({ event: "diagnostic", ...result.diagnostics[0] });
    result.exitCode = TEST_EXIT.ERROR;
    result.durationMs = Math.round(performance.now() - started);
    onEvent({ event: "run-end", result });
    return result;
  }

  const needle = String(filter ?? "").toLowerCase();
  const wanted = (file, test) =>
    needle === "" ||
    file.toLowerCase().includes(needle) ||
    test.toLowerCase().includes(needle);

  for (const file of parsed.files) {
    const selected = file.tests.filter((test) => wanted(file.file, test.name));
    if (selected.length === 0) continue;

    const fileResult = {
      file: file.file,
      status: "passed",
      durationMs: 0,
      tests: [],
    };
    const fileStart = performance.now();
    onEvent({ event: "file-start", file: file.file });

    for (const test of selected) {
      onEvent({ event: "test-start", file: file.file, name: test.name });
      let outcome;
      try {
        outcome = await runOneTest({
          test,
          helpers: file.helpers,
          sb3: built.sb3,
          config,
          seed: config.seed,
        });
      } catch (error) {
        outcome = {
          name: test.name,
          status: "failed",
          durationMs: 0,
          ticks: 0,
          seed: config.seed,
          error: {
            name: error?.name ?? "Error",
            message: error?.message ?? String(error),
            ...locOf(test),
          },
        };
      }
      fileResult.tests.push(outcome);
      result.counts.tests += 1;
      if (outcome.status === "passed") result.counts.passed += 1;
      else if (outcome.status === "failed") result.counts.failed += 1;
      else result.counts.pending += 1;
      onEvent({
        event: "test-result",
        file: file.file,
        ...outcome,
      });
    }

    fileResult.durationMs = Math.round(performance.now() - fileStart);
    if (fileResult.tests.some((item) => item.status === "failed"))
      fileResult.status = "failed";
    result.files.push(fileResult);
    if (fileResult.status === "passed") result.counts.passedFiles += 1;
    else result.counts.failedFiles += 1;
    onEvent({
      event: "file-result",
      file: file.file,
      status: fileResult.status,
      tests: fileResult.tests,
      durationMs: fileResult.durationMs,
    });
  }

  result.durationMs = Math.round(performance.now() - started);
  result.ok = result.counts.failed === 0 && result.counts.tests > 0;
  result.exitCode =
    result.counts.tests === 0
      ? TEST_EXIT.ERROR
      : result.counts.failed > 0
        ? TEST_EXIT.FAILED
        : TEST_EXIT.OK;
  if (result.counts.tests === 0)
    result.diagnostics.push({
      file: null,
      message: `No tests matched ${JSON.stringify(filter)}`,
    });

  onEvent({ event: "run-end", result });
  return result;
}

/** Format one failure for reporters. */
export function formatFailure(error) {
  return describeFailure(error);
}
