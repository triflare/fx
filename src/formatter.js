/**
 * Triflare Fx source formatter.
 *
 * The formatter walks the parsed AST to decide structure and spacing, and
 * replays the lexer's comment log to keep comments attached to the code around
 * them. Formatting never compiles a project, so it cannot change generated
 * project behavior, and running it twice produces no further changes.
 *
 * Canonical style:
 * - four-space indentation, one statement per line;
 * - `{` on the same line as its header, `} else {` for alternates;
 * - single spaces around operators, after commas, and after colons;
 * - double-quoted strings with minimal escapes;
 * - unchanged declaration order and project data.
 */
import { tokenizeWithComments } from "./lexer.js";
import { parseTokens } from "./parser.js";

const INDENT = "    ";

/** Binding strength of binary operators; larger binds tighter. */
const PRECEDENCE = {
  or: 1,
  and: 2,
  "==": 3,
  "!=": 3,
  "<": 3,
  "<=": 3,
  ">": 3,
  ">=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
};

const UNARY_PRECEDENCE = 6;

function escapeString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function stringLiteral(value) {
  return `"${escapeString(value)}"`;
}

function isIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function mapKey(key) {
  return isIdentifier(key) ? key : stringLiteral(key);
}

/**
 * Render an expression, adding parentheses only where the AST needs them to
 * survive a round trip through the parser.
 *
 * @param {object} node
 * @param {number} [minimum] lowest precedence allowed without parentheses
 * @param {string} [parentOperator] operator receiving this expression
 * @returns {string}
 */
function renderExpression(node, minimum = 0, parentOperator) {
  switch (node.type) {
    case "Number":
      return String(node.value);
    case "String":
      return stringLiteral(node.value);
    case "Boolean":
      return node.value ? "true" : "false";
    case "Identifier":
      return node.name;
    case "Call":
      return `${node.name}(${node.args
        .map((arg) => renderExpression(arg))
        .join(", ")})`;
    case "ArrayLiteral":
      return `[${node.items.map((item) => renderExpression(item)).join(", ")}]`;
    case "Unary": {
      const operand = renderExpression(node.operand, UNARY_PRECEDENCE, node.op);
      if (node.op === "not") {
        const text = `not ${operand}`;
        return parentOperator && !["and", "or", "not"].includes(parentOperator)
          ? `(${text})`
          : text;
      }
      // `--x` is legal but reads like a decrement waiting to happen.
      const nested = node.operand.type === "Unary" && node.operand.op === "-";
      return `-${nested ? `(${operand})` : operand}`;
    }
    case "Binary": {
      const precedence = PRECEDENCE[node.op] ?? 0;
      const left = renderExpression(node.left, precedence, node.op);
      // Right operands need parentheses at equal precedence to keep left
      // associativity from regrouping them, e.g. `a - (b - c)`.
      const right = renderExpression(node.right, precedence + 1, node.op);
      const text = `${left} ${node.op} ${right}`;
      return precedence < minimum ? `(${text})` : text;
    }
    default:
      throw new Error(`Cannot format expression node ${node.type}`);
  }
}

/** Render a hat event: a bare name when it takes no arguments. */
function renderEvent(event) {
  if (event.args.length === 0) return event.segments.join(".");
  return `${event.segments.join(".")}(${event.args
    .map((arg) => renderExpression(arg))
    .join(", ")})`;
}

/** Group statements so the formatter can insert stable blank lines. */
function category(node) {
  switch (node.type) {
    case "StageDecl":
    case "SpriteDecl":
      return "declaration";
    case "PropertyDecl":
      return "property";
    case "VarDecl":
    case "ListDecl":
      return "data";
    case "FunctionDecl":
      return "function";
    case "HatDecl":
      return "script";
    default:
      return "statement";
  }
}

/** Whether two adjacent statements belong in separate visual groups. */
function needsBlankLine(previous, next) {
  const before = category(previous);
  const after = category(next);
  if (before !== after) return true;
  return (
    before === "declaration" || before === "function" || before === "script"
  );
}

class Formatter {
  /**
   * @param {string} source
   * @param {string} file
   */
  constructor(source, file) {
    const { tokens, comments } = tokenizeWithComments(source, file);
    this.sourceLines = source.split(/\r?\n/);
    this.tokens = tokens;
    this.comments = comments;
    this.commentIndex = 0;
    this.tokenIndexes = new Map();
    tokens.forEach((token, index) => this.tokenIndexes.set(token, index));
    this.out = [];
    this.program = parseTokens(tokens, source, file);
  }

  /** Token index for a loc that the parser took straight from the lexer. */
  tokenIndexOf(token) {
    return this.tokenIndexes.get(token) ?? this.tokens.length - 1;
  }

  /** First token with `value` at or after `from`, or -1. */
  findToken(from, value) {
    for (let index = Math.max(0, from); index < this.tokens.length; index += 1)
      if (this.tokens[index].value === value) return index;
    return -1;
  }

  /** Index of the `}` matching the `{` at `open`. */
  matchBrace(open) {
    let depth = 0;
    for (let index = open; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.type !== "punct") continue;
      if (token.value === "{") depth += 1;
      else if (token.value === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return this.tokens.length - 1;
  }

  /** Token span of a node's block body. */
  bodySpan(node) {
    const open = this.findToken(this.tokenIndexOf(node.loc), "{");
    return { open, close: this.matchBrace(open) };
  }

  /** Whether a comment can share the previous output line. */
  canInline(comment) {
    if (/\r(?!$)|\n/.test(comment.text)) return false;
    if (this.out.length === 0) return false;
    if (this.out[this.out.length - 1].trim() === "") return false;
    const previous = this.tokens[comment.after - 1];
    return Boolean(previous && previous.line === comment.line);
  }

  /** Attach only the trailing comments that belong on the previous line. */
  flushInline(limit) {
    while (this.commentIndex < this.comments.length) {
      const comment = this.comments[this.commentIndex];
      if (comment.after > limit || !this.canInline(comment)) return;
      this.commentIndex += 1;
      this.out[this.out.length - 1] += ` ${comment.text.trim()}`;
    }
  }

  /**
   * Emit every comment that appears before token `limit`.
   *
   * @param {number} limit
   * @param {number} indent
   */
  flush(limit, indent) {
    const pad = INDENT.repeat(indent);
    while (this.commentIndex < this.comments.length) {
      const comment = this.comments[this.commentIndex];
      if (comment.after > limit) break;
      this.commentIndex += 1;
      // The lexer includes the CR of a CRLF terminator in line comments.
      const text = comment.text.startsWith("//")
        ? comment.text.replace(/\r$/, "")
        : comment.text;
      const lines = text
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .split("\n");
      if (lines.length === 1 && this.canInline(comment)) {
        this.out[this.out.length - 1] += ` ${lines[0].trim()}`;
        continue;
      }
      this.out.push(`${pad}${lines[0]}`);
      for (let index = 1; index < lines.length; index += 1)
        this.out.push(lines[index]);
    }
  }

  pushBlank() {
    if (this.out.length === 0) return;
    if (this.out[this.out.length - 1] === "") return;
    this.out.push("");
  }

  /** Whether the source has a blank line strictly between two lines. */
  hasBlankBetween(fromLine, toLine) {
    for (let line = fromLine + 1; line < toLine; line += 1)
      if ((this.sourceLines[line - 1] ?? "").trim() === "") return true;
    return false;
  }

  /**
   * Render a statement list, flushing comments between its statements.
   *
   * Blank lines are canonical: declarations, functions and scripts are always
   * separated, an intentional single blank line in the source survives, and
   * runs of blank lines collapse to one.
   */
  renderBody(items, indent, closeIndex) {
    items.forEach((item, index) => {
      const start = this.tokenIndexOf(item.loc);
      if (index > 0) {
        this.flushInline(start);
        const previousLine = this.tokens[start - 1]?.line ?? 0;
        if (
          needsBlankLine(items[index - 1], item) ||
          this.hasBlankBetween(previousLine, item.loc.line)
        )
          this.pushBlank();
      }
      const pending = this.comments[this.commentIndex];
      this.flush(start, indent);
      // Keep a file header comment separated from the first declaration, or a
      // leading comment inside a block separated from the code it introduces.
      if (index === 0 && pending && pending.after <= start) {
        const last = this.comments[this.commentIndex - 1];
        const endLine = last.line + (last.text.match(/\n/g)?.length ?? 0);
        if (this.hasBlankBetween(endLine, item.loc.line)) this.pushBlank();
      }
      this.renderItem(item, indent);
    });
    this.flush(closeIndex, indent);
  }

  /** Render the block body of a node that owns braces. */
  renderNodeBody(node, indent) {
    this.renderBody(node.body, indent + 1, this.bodySpan(node).close);
  }

  renderItem(node, indent) {
    const pad = INDENT.repeat(indent);
    switch (node.type) {
      case "StageDecl":
        this.out.push(`${pad}stage {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      case "SpriteDecl": {
        const modifier = node.partial ? "partial " : "";
        this.out.push(`${pad}${modifier}sprite ${stringLiteral(node.name)} {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      }
      case "PropertyDecl":
        this.renderProperty(node, indent);
        return;
      case "VarDecl":
        this.out.push(
          `${pad}${node.cloud ? "cloud " : ""}let ${node.name}` +
            `${node.init ? ` = ${renderExpression(node.init)}` : ""};`,
        );
        return;
      case "ListDecl":
        this.out.push(
          `${pad}list ${node.name} = [${node.items
            .map((item) => renderExpression(item))
            .join(", ")}];`,
        );
        return;
      case "FunctionDecl": {
        const modifiers = `${node.returns ? "returning " : ""}${
          node.warp ? "warp " : ""
        }`;
        const params = node.params
          .map((param) =>
            param.type ? `${param.name}: ${param.type}` : param.name,
          )
          .join(", ");
        this.out.push(`${pad}${modifiers}function ${node.name}(${params}) {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      }
      case "HatDecl":
        this.out.push(`${pad}when ${renderEvent(node.event)} {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      case "If":
        this.renderIf(node, indent);
        return;
      case "Repeat":
        this.out.push(`${pad}repeat (${renderExpression(node.count)}) {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      case "While":
        this.out.push(`${pad}while (${renderExpression(node.cond)}) {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      case "Forever":
        this.out.push(`${pad}forever {`);
        this.renderNodeBody(node, indent);
        this.out.push(`${pad}}`);
        return;
      case "Return":
        this.out.push(
          `${pad}return${node.value ? ` ${renderExpression(node.value)}` : ""};`,
        );
        return;
      case "Assign":
        this.out.push(
          `${pad}${node.name} ${node.op} ${renderExpression(node.value)};`,
        );
        return;
      case "BlockCall":
        this.renderBlockCall(node, indent);
        return;
      default:
        throw new Error(`Cannot format statement node ${node.type}`);
    }
  }

  renderProperty(node, indent) {
    const pad = INDENT.repeat(indent);
    if (!Array.isArray(node.value)) {
      this.out.push(`${pad}${node.key}: ${renderExpression(node.value)};`);
      return;
    }
    if (node.value.length === 0) {
      this.out.push(`${pad}${node.key}: {};`);
      return;
    }
    const span = this.bodySpan(node);
    const inner = INDENT.repeat(indent + 1);
    this.out.push(`${pad}${node.key}: {`);
    node.value.forEach((entry, index) => {
      this.flush(this.tokenIndexOf(entry.loc), indent + 1);
      const comma = index === node.value.length - 1 ? "" : ",";
      this.out.push(
        `${inner}${mapKey(entry.key)}: ${stringLiteral(entry.value)}${comma}`,
      );
    });
    this.flush(span.close, indent + 1);
    this.out.push(`${pad}};`);
  }

  /** Find the `else` token that follows a block's closing brace. */
  elseIndexAfter(close) {
    const index = this.findToken(close + 1, "else");
    return index === close + 1 ? index : -1;
  }

  renderIf(node, indent, prefix = "") {
    const pad = INDENT.repeat(indent);
    const span = this.bodySpan(node);
    this.out.push(`${pad}${prefix}if (${renderExpression(node.cond)}) {`);
    this.renderBody(node.then, indent + 1, span.close);
    if (!node.else) {
      this.out.push(`${pad}}`);
      return;
    }
    const elseIndex = this.elseIndexAfter(span.close);
    // Comments between `}` and `else` cannot sit on their own line without
    // breaking the statement, so keep them inside the preceding block.
    if (elseIndex !== -1) this.flush(elseIndex, indent + 1);
    if (node.else.length === 1 && node.else[0].type === "If") {
      this.renderIf(node.else[0], indent, "} else ");
      return;
    }
    const elseOpen = elseIndex === -1 ? span.close + 1 : elseIndex + 1;
    const elseClose = this.matchBrace(elseOpen);
    this.out.push(`${pad}} else {`);
    this.renderBody(node.else, indent + 1, elseClose);
    this.out.push(`${pad}}`);
  }

  renderBlockCall(node, indent) {
    const pad = INDENT.repeat(indent);
    const args = node.args.map((arg) => renderExpression(arg)).join(", ");
    // `control.forever { }` reads better than `control.forever() { }`, and the
    // parser treats them identically.
    const head =
      node.body && node.args.length === 0
        ? `${pad}${node.name}`
        : `${pad}${node.name}(${args})`;
    if (!node.body) {
      this.out.push(`${head};`);
      return;
    }
    const span = this.bodySpan(node);
    this.out.push(`${head} {`);
    this.renderBody(node.body, indent + 1, span.close);
    if (!node.else) {
      this.out.push(`${pad}}`);
      return;
    }
    const elseIndex = this.elseIndexAfter(span.close);
    if (elseIndex !== -1) this.flush(elseIndex, indent + 1);
    const elseOpen = elseIndex === -1 ? span.close + 1 : elseIndex + 1;
    const elseClose = this.matchBrace(elseOpen);
    this.out.push(`${pad}} else {`);
    this.renderBody(node.else, indent + 1, elseClose);
    this.out.push(`${pad}}`);
  }

  format() {
    const units = [];
    if (this.program.stage) units.push(this.program.stage);
    units.push(...this.program.sprites, ...this.program.topItems);
    // Preserve the order declarations had in this file; only separate them.
    units.sort((a, b) => this.tokenIndexOf(a.loc) - this.tokenIndexOf(b.loc));
    this.renderBody(units, 0, this.tokens.length - 1);
    if (this.out.length === 0) return "";
    return `${this.out.join("\n")}\n`;
  }
}

/**
 * Format Triflare Fx source into the canonical style.
 *
 * Throws `LexError`/`ParseError` with source locations when the input cannot
 * be parsed; callers must leave such files untouched.
 *
 * @param {string} source
 * @param {string} [file]
 * @returns {string}
 */
export function formatSource(source, file = "<input>") {
  return new Formatter(source, file).format();
}
