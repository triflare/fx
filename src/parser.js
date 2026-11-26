/**
 * Triflare Fx parser.
 *
 * Recursive-descent parser turning a token stream into a small, explicit AST.
 * Triflare Fx is intentionally context-free: keywords are recognised by shape
 * (`sprite "..."`, `when <event>`, `let ...`) rather than being reserved words.
 */
import { tokenizeWithComments } from "./lexer.js";
import { ParseError } from "./errors.js";
import { attachComments } from "./comments.js";

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);
const PROPERTY_KEYS = new Set(["layer", "costumes", "sounds"]);

class Parser {
  /**
   * @param {import('./lexer.js').Token[]} tokens
   * @param {string} source
   * @param {string} file
   */
  constructor(tokens, source, file) {
    this.tokens = tokens;
    this.source = source;
    this.file = file;
    this.pos = 0;
    // Brace tokens for every body, kept out of the AST so comments can be
    // placed by source range without changing the node shapes.
    this.spans = new WeakMap();
  }

  /** Record the braces surrounding a node's body (and else branch). */
  span(node, bodyOpen, bodyClose, elseOpen = null, elseClose = null) {
    this.spans.set(node, { bodyOpen, bodyClose, elseOpen, elseClose });
    return node;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  at(value, type) {
    const tok = this.peek();
    if (type && tok.type !== type) return false;
    return tok.value === value;
  }

  atIdent(value) {
    const tok = this.peek();
    return tok.type === "ident" && tok.value === value;
  }

  atPunct(value) {
    const tok = this.peek();
    return tok.type === "punct" && tok.value === value;
  }

  eat(value, type) {
    if (this.at(value, type)) {
      return this.next();
    }
    return null;
  }

  expect(value, type) {
    if (this.at(value, type)) return this.next();
    this.fail(
      `Expected ${JSON.stringify(value)} but found ${this.describe(this.peek())}`,
    );
  }

  expectIdent() {
    const tok = this.peek();
    if (tok.type !== "ident")
      this.fail(`Expected an identifier but found ${this.describe(tok)}`);
    return this.next().value;
  }

  expectType(type, what = type) {
    const tok = this.peek();
    if (tok.type !== type)
      this.fail(`Expected ${what} but found ${this.describe(tok)}`);
    return this.next();
  }

  describe(tok) {
    if (tok.type === "eof") return "end of file";
    if (tok.type === "string") return `string ${JSON.stringify(tok.value)}`;
    return JSON.stringify(tok.value);
  }

  fail(message, tok = this.peek()) {
    throw new ParseError(message, {
      file: this.file,
      line: tok.line,
      column: tok.column,
      source: this.source,
    });
  }

  // ------------------------------------------------------------------ core

  parse() {
    const sprites = [];
    let stage = null;
    const topItems = [];
    const tests = [];

    while (this.peek().type !== "eof") {
      if (
        this.atIdent("partial") &&
        this.peek(1).type === "ident" &&
        this.peek(1).value === "sprite" &&
        this.peek(2).type === "string"
      ) {
        const tok = this.next();
        sprites.push(this.parseSprite(true, tok));
      } else if (this.atIdent("sprite") && this.peek(1).type === "string") {
        sprites.push(this.parseSprite());
      } else if (
        this.atIdent("stage") &&
        this.peek(1).type === "punct" &&
        this.peek(1).value === "{"
      ) {
        if (stage) this.fail("A project may only declare one stage");
        stage = this.parseStage();
      } else if (
        this.atIdent("test") &&
        this.peek(1).type === "string" &&
        this.peek(2).type === "punct" &&
        this.peek(2).value === "{"
      ) {
        tests.push(this.parseTestDecl());
      } else {
        topItems.push(this.parseBodyItem());
      }
    }

    return { type: "Program", stage, sprites, topItems, tests };
  }

  /** `test "name" { ... }` — only valid in test files. */
  parseTestDecl() {
    const tok = this.expect("test");
    const name = this.expectType("string", "a test name string").value;
    const { body, open, close } = this.parseBlockBody(true);
    return this.span({ type: "TestDecl", name, body, loc: tok }, open, close);
  }

  /** `expect <expression>[, "message"];` */
  parseExpect() {
    const tok = this.expect("expect");
    const value = this.parseExpression();
    let message = null;
    if (this.eat(","))
      message = this.expectType("string", "an assertion message string").value;
    this.expect(";");
    return { type: "Expect", value, message, loc: tok };
  }

  parseSprite(partial = false, startTok = null) {
    const tok = this.expect("sprite");
    const name = this.expectType("string", "a sprite name string").value;
    const { body, open, close } = this.parseBlockBody(true);
    return this.span(
      {
        type: "SpriteDecl",
        name,
        body,
        loc: startTok ?? tok,
        // Tokens are the brace's position, needed to insert declarations into
        // the body when the brace is not on the declaration line.
        open,
        partial,
      },
      open,
      close,
    );
  }

  parseStage() {
    const tok = this.expect("stage");
    const { body, open, close } = this.parseBlockBody(true);
    return this.span(
      { type: "StageDecl", name: "Stage", body, loc: tok, open },
      open,
      close,
    );
  }

  /**
   * Parse `{ ... }`.
   * @param {boolean} [withOpen] return `{body, open}` instead of the items only
   */
  parseBlockBody(withOpen = false) {
    const open = this.expect("{");
    const items = [];
    while (!this.atPunct("}")) {
      if (this.peek().type === "eof")
        this.fail('Unterminated block; expected "}"');
      items.push(this.parseBodyItem());
    }
    const close = this.expect("}");
    return withOpen ? { body: items, open, close } : items;
  }

  parseBodyItem() {
    const tok = this.peek();

    if (tok.type === "ident") {
      switch (tok.value) {
        case "let":
          return this.parseVarDecl(false);
        case "cloud":
          if (this.peek(1).type === "ident" && this.peek(1).value === "let") {
            return this.parseVarDecl(true);
          }
          break;
        case "thread":
        case "runtime":
          if (this.peek(1).type === "ident" && this.peek(1).value === "let") {
            return this.parseTempVarDecl(tok.value);
          }
          break;
        case "list":
          if (this.peek(1).type === "ident") {
            return this.parseListDecl();
          }
          break;
        case "function":
          return this.parseFunctionDecl(false, false);
        case "returning":
        case "warp": {
          const otherModifier =
            tok.value === "returning" ? "warp" : "returning";
          const combined =
            this.peek(1).type === "ident" &&
            this.peek(1).value === otherModifier;
          if (
            this.peek(combined ? 2 : 1).type === "ident" &&
            this.peek(combined ? 2 : 1).value === "function"
          ) {
            return this.parseFunctionDecl(
              tok.value === "returning" || combined,
              tok.value === "warp" || combined,
            );
          }
          break;
        }
        case "when":
          return this.parseHat();
        case "expect":
          // A complete call or assignment stays a normal statement. An
          // expression continuing after the closing parenthesis is an assertion.
          if (
            !(
              this.peek(1).type === "punct" &&
              ASSIGN_OPS.has(this.peek(1).value)
            ) &&
            !this.isExpectCall()
          )
            return this.parseExpect();
          break;
        case "if":
          return this.parseIf();
        case "repeat":
          return this.parseRepeat();
        case "while":
          return this.parseWhile();
        case "forever":
          return this.parseForever();
        case "return":
          return this.parseReturn();
        default:
          break;
      }

      if (
        PROPERTY_KEYS.has(tok.value) &&
        this.peek(1).type === "punct" &&
        this.peek(1).value === ":"
      ) {
        return this.parseProperty();
      }
    }

    return this.parseSimpleStatement();
  }

  isExpectCall() {
    if (this.peek(1).type !== "punct" || this.peek(1).value !== "(")
      return false;
    let depth = 0;
    for (let offset = 1; this.peek(offset).type !== "eof"; offset++) {
      const token = this.peek(offset);
      if (token.type !== "punct") continue;
      if (token.value === "(") depth++;
      if (token.value === ")" && --depth === 0) {
        const next = this.peek(offset + 1);
        return next.type === "punct" && [";", "{"].includes(next.value);
      }
    }
    return false;
  }

  parseVarDecl(cloud) {
    const tok = cloud ? this.expect("cloud") : this.expect("let");
    if (cloud) this.expect("let");
    const name = this.expectIdent();
    let init = null;
    if (this.eat("=")) init = this.parseExpression();
    this.expect(";");
    return { type: "VarDecl", name, init, cloud, loc: tok };
  }

  parseTempVarDecl(kind) {
    const tok = this.next();
    this.expect("let");
    const name = this.expectIdent();
    let init = null;
    if (this.eat("=")) init = this.parseExpression();
    this.expect(";");
    return { type: "TempVarDecl", kind, name, init, loc: tok };
  }

  parseListDecl() {
    const tok = this.expect("list");
    const name = this.expectIdent();
    let items = [];
    if (this.eat("=")) {
      this.expect("[");
      items = this.parseExpressionList("]");
      this.expect("]");
    }
    this.expect(";");
    return { type: "ListDecl", name, items, loc: tok };
  }

  parseFunctionDecl(returns, warp) {
    const tok = this.peek();
    while (this.atIdent("returning") || this.atIdent("warp")) this.next();
    this.expect("function");
    const name = this.expectIdent();
    this.expect("(");
    const params = [];
    while (!this.atPunct(")")) {
      const ptok = this.peek();
      const paramName = this.expectIdent();
      let boolean = false;
      let type = null;
      // Optional type annotation: `flag: boolean`
      if (this.eat(":")) {
        type = this.expectIdent();
        if (type === "boolean") boolean = true;
        else if (type !== "number" && type !== "string") {
          this.fail(`Unknown parameter type ${JSON.stringify(type)}`, ptok);
        }
      }
      params.push({ name: paramName, boolean, type });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    const { body, open, close } = this.parseBlockBody(true);
    return this.span(
      { type: "FunctionDecl", name, params, returns, warp, body, loc: tok },
      open,
      close,
    );
  }

  parseHat() {
    const tok = this.expect("when");
    const event = this.parseCallOrIdentifier();
    const { body, open, close } = this.parseBlockBody(true);
    return this.span({ type: "HatDecl", event, body, loc: tok }, open, close);
  }

  parseProperty() {
    const tok = this.peek();
    const key = this.expectIdent();
    this.expect(":");
    let value;
    if (this.atPunct("{")) {
      value = this.parseStringMap();
    } else {
      value = this.parseExpression();
    }
    this.expect(";");
    return { type: "PropertyDecl", key, value, loc: tok };
  }

  parseStringMap() {
    this.expect("{");
    const map = [];
    while (!this.atPunct("}")) {
      const keyTok = this.peek();
      let key;
      if (keyTok.type === "ident") key = this.next().value;
      else if (keyTok.type === "string") key = this.next().value;
      else
        this.fail(
          `Expected a costume/sound name but found ${this.describe(keyTok)}`,
        );
      this.expect(":");
      const valTok = this.expectType("string", "an asset path string");
      map.push({ key, value: valTok.value, loc: keyTok });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return map;
  }

  // ------------------------------------------------------------ statements

  parseIf() {
    const tok = this.expect("if");
    let cond;
    if (this.eat("(")) {
      cond = this.parseExpression();
      this.expect(")");
    } else {
      cond = this.parseExpression();
    }
    const then = this.parseBlockBody(true);
    let elseBody = null;
    let elseOpen = null;
    let elseClose = null;
    if (this.atIdent("else")) {
      this.next();
      if (this.atIdent("if")) {
        elseBody = [this.parseIf()];
      } else {
        ({
          body: elseBody,
          open: elseOpen,
          close: elseClose,
        } = this.parseBlockBody(true));
      }
    }
    return this.span(
      { type: "If", cond, then: then.body, else: elseBody, loc: tok },
      then.open,
      then.close,
      elseOpen,
      elseClose,
    );
  }

  parseRepeat() {
    const tok = this.expect("repeat");
    let count;
    if (this.eat("(")) {
      count = this.parseExpression();
      this.expect(")");
    } else {
      count = this.parseExpression();
    }
    const { body, open, close } = this.parseBlockBody(true);
    return this.span({ type: "Repeat", count, body, loc: tok }, open, close);
  }

  parseWhile() {
    const tok = this.expect("while");
    let cond;
    if (this.eat("(")) {
      cond = this.parseExpression();
      this.expect(")");
    } else {
      cond = this.parseExpression();
    }
    const { body, open, close } = this.parseBlockBody(true);
    return this.span({ type: "While", cond, body, loc: tok }, open, close);
  }

  parseForever() {
    const tok = this.expect("forever");
    const { body, open, close } = this.parseBlockBody(true);
    return this.span({ type: "Forever", body, loc: tok }, open, close);
  }

  parseReturn() {
    const tok = this.expect("return");
    let value = null;
    if (!this.atPunct(";")) value = this.parseExpression();
    this.expect(";");
    return { type: "Return", value, loc: tok };
  }

  parseSimpleStatement() {
    const tok = this.peek();
    const name = this.parseQualifiedName();

    // Assignment to a (possibly scoped) variable.
    if (
      name.segments.length === 1 &&
      this.peek().type === "punct" &&
      ASSIGN_OPS.has(this.peek().value)
    ) {
      const op = this.next().value;
      const value = this.parseExpression();
      this.expect(";");
      return { type: "Assign", name: name.segments[0], op, value, loc: tok };
    }

    let args = [];
    if (this.eat("(")) {
      args = this.parseExpressionList(")");
      this.expect(")");
    }

    let body = null;
    let bodyOpen = null;
    let bodyClose = null;
    let elseBody = null;
    let elseOpen = null;
    let elseClose = null;
    if (this.atPunct("{")) {
      ({ body, open: bodyOpen, close: bodyClose } = this.parseBlockBody(true));
      if (this.atIdent("else")) {
        this.next();
        if (this.atIdent("if")) elseBody = [this.parseIf()];
        else {
          ({
            body: elseBody,
            open: elseOpen,
            close: elseClose,
          } = this.parseBlockBody(true));
        }
      }
      this.eat(";");
    } else {
      this.expect(";");
    }
    return this.span(
      {
        type: "BlockCall",
        name: name.name,
        segments: name.segments,
        args,
        body,
        else: elseBody,
        loc: tok,
      },
      bodyOpen,
      bodyClose,
      elseOpen,
      elseClose,
    );
  }

  parseCallOrIdentifier() {
    const name = this.parseQualifiedName();
    if (this.eat("(")) {
      const args = this.parseExpressionList(")");
      this.expect(")");
      return { name: name.name, segments: name.segments, args };
    }
    return { name: name.name, segments: name.segments, args: [] };
  }

  parseQualifiedName() {
    const tok = this.peek();
    const segments = [this.expectIdent()];
    while (this.atPunct(".") && this.peek(1).type === "ident") {
      this.next();
      segments.push(this.next().value);
    }
    return { name: segments.join("."), segments, loc: tok };
  }

  /**
   * Postfix member access on a call result, as in
   * `state.list("items").length`. Qualified identifiers already absorb their
   * segments while they are parsed.
   */
  parseMemberAccess(expression) {
    let node = expression;
    while (this.atPunct(".") && this.peek(1).type === "ident") {
      this.next();
      const property = this.next();
      node = {
        type: "Member",
        object: node,
        property: property.value,
        loc: property,
      };
    }
    return node;
  }

  parseExpressionList(closing) {
    const list = [];
    if (this.atPunct(closing)) return list;
    list.push(this.parseExpression());
    while (this.eat(",")) {
      if (this.atPunct(closing)) break; // tolerate trailing comma
      list.push(this.parseExpression());
    }
    return list;
  }

  // ----------------------------------------------------------- expressions

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.atIdent("or") || this.atPunct("||")) {
      this.next();
      const right = this.parseAnd();
      left = { type: "Binary", op: "or", left, right, loc: left.loc };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.atIdent("and") || this.atPunct("&&")) {
      this.next();
      const right = this.parseNot();
      left = { type: "Binary", op: "and", left, right, loc: left.loc };
    }
    return left;
  }

  parseNot() {
    if (this.atIdent("not") || this.atPunct("!")) {
      const tok = this.next();
      const operand = this.parseNot();
      return { type: "Unary", op: "not", operand, loc: tok };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (
      this.peek().type === "punct" &&
      ["==", "!=", "<", "<=", ">", ">="].includes(this.peek().value)
    ) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (
      this.peek().type === "punct" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (
      this.peek().type === "punct" &&
      ["*", "/", "%"].includes(this.peek().value)
    ) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseUnary() {
    if (this.atPunct("-")) {
      const tok = this.next();
      const operand = this.parseUnary();
      if (operand.type === "Number") {
        return { type: "Number", value: -operand.value, loc: tok };
      }
      return { type: "Unary", op: "-", operand, loc: tok };
    }
    if (this.atPunct("+")) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.type === "number") {
      this.next();
      return { type: "Number", value: Number(tok.value), loc: tok };
    }
    if (tok.type === "string") {
      this.next();
      return { type: "String", value: tok.value, loc: tok };
    }
    if (tok.type === "punct" && tok.value === "(") {
      this.next();
      const expr = this.parseExpression();
      this.expect(")");
      return expr;
    }
    if (tok.type === "punct" && tok.value === "[") {
      this.next();
      const items = this.parseExpressionList("]");
      this.expect("]");
      return { type: "ArrayLiteral", items, loc: tok };
    }
    if (tok.type === "ident") {
      if (tok.value === "true" || tok.value === "false") {
        this.next();
        return { type: "Boolean", value: tok.value === "true", loc: tok };
      }
      const name = this.parseQualifiedName();
      if (this.eat("(")) {
        const args = this.parseExpressionList(")");
        this.expect(")");
        return this.parseMemberAccess({
          type: "Call",
          name: name.name,
          segments: name.segments,
          args,
          loc: tok,
        });
      }
      return {
        type: "Identifier",
        name: name.name,
        segments: name.segments,
        loc: tok,
      };
    }

    this.fail(`Unexpected ${this.describe(tok)} in expression`);
  }
}

/**
 * Parse a Triflare Fx source string into an AST.
 * @param {string} source
 * @param {string} [file]
 */
export function parse(source, file = "<input>") {
  const { tokens, comments } = tokenizeWithComments(source, file);
  const parser = new Parser(tokens, source, file);
  const ast = parser.parse();
  attachComments(ast, comments, tokens, parser.spans);
  return ast;
}

/**
 * Parse an existing token stream. Keeping the caller's tokens lets tools such
 * as the formatter match AST locations back to tokens without re-lexing.
 * @param {import('./lexer.js').Token[]} tokens
 * @param {string} source
 * @param {string} [file]
 */
export function parseTokens(tokens, source, file = "<input>") {
  return new Parser(tokens, source, file).parse();
}
