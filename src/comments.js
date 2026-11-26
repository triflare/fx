/**
 * Attach source comments to the AST.
 *
 * Comments are not part of the token stream. After parsing, each comment is
 * resolved to the block-bearing declaration or statement it belongs to:
 *
 * - a comment before an item attaches to that item (`comments` on the node),
 * - a trailing comment on an item's own line attaches to that item,
 * - a comment inside a block body with nothing after it attaches to the
 *   enclosing block,
 * - comments that cannot sit on a block (before a sprite, variable, list or
 *   property declaration, or in an empty sprite) become standalone workspace
 *   comments on the target they belong to.
 *
 * Comments inside `test` declarations are dropped: test files are never part of
 * a built project.
 */

/** AST node types that compile to at least one block. */
const BLOCK_OWNERS = new Set([
  "Assign",
  "BlockCall",
  "Forever",
  "FunctionDecl",
  "HatDecl",
  "If",
  "Repeat",
  "Return",
  "TempVarDecl",
  "While",
]);

/**
 * Turn a raw `//` or block comment into the text Scratch should display.
 * Block-comment asterisk decorations are removed line by line.
 * @param {string} raw
 * @returns {string}
 */
export function commentText(raw) {
  const source = raw.replace(/\r\n?/g, "\n");
  if (source.startsWith("//")) return source.slice(2).trim();
  if (source.startsWith("/*") && source.endsWith("*/")) {
    const lines = source
      .slice(2, -2)
      .split("\n")
      .map((line) => line.replace(/^\s*\*?[ \t]?/, "").trimEnd());
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n").trim();
  }
  return source.trim();
}

/**
 * Resolve comment placement for a freshly parsed program.
 * @param {object} ast program node (mutated with attachments)
 * @param {Array} comments lexer comments
 * @param {Array} tokens lexer tokens
 * @param {WeakMap<object, object>} spans body brace tokens per node
 */
export function attachComments(ast, comments, tokens, spans) {
  const standalone = [];
  if (comments.length > 0) {
    const indexes = new Map();
    tokens.forEach((token, index) => indexes.set(token, index));

    const programItems = [
      ...(ast.stage ? [ast.stage] : []),
      ...ast.sprites,
      ...ast.topItems,
      ...(ast.tests || []),
    ].filter((item) => indexes.has(item.loc));

    const scopes = [
      {
        items: programItems,
        open: -1,
        close: tokens.length - 1,
        owner: null,
        target: "Stage",
      },
    ];
    for (const item of programItems)
      collectScopes(item, scopes, "Stage", indexes, spans);

    for (const comment of comments) {
      const text = commentText(comment.text);
      if (!text) continue;
      placeComment(
        ast,
        innermostScope(scopes, comment.after),
        comment,
        text,
        indexes,
      );
    }
  }
  ast.standaloneComments = standalone;

  function addStandalone(text, target) {
    if (target) standalone.push({ text, target });
  }

  function placeComment(program, scope, comment, text, indexes) {
    const items = scope.items
      .map((item) => ({ item, index: indexes.get(item.loc) }))
      .filter((entry) => entry.index !== undefined)
      .sort((a, b) => a.index - b.index);

    // A comment after code on the same line belongs to that code.
    const sameLine = items.findLast(
      (entry) =>
        entry.item.loc.line === comment.line && entry.index < comment.after,
    );
    if (sameLine) return place(program, scope, sameLine.item, text);

    const next = items.find((entry) => entry.index >= comment.after);
    if (next) return place(program, scope, next.item, text);

    const previous = items.findLast((entry) => entry.index < comment.after);
    if (previous) return place(program, scope, previous.item, text);

    // An empty body: the comment describes the block or sprite that owns it.
    if (scope.owner) return place(program, scope, scope.owner, text);
    addStandalone(text, scope.target);
  }

  function place(program, scope, item, text) {
    if (item.type === "TestDecl") return;
    if (BLOCK_OWNERS.has(item.type)) {
      item.comments = item.comments || [];
      item.comments.push(text);
      return;
    }
    addStandalone(text, targetFor(item, scope));
  }
}

/** Which target a comment belongs to when it cannot be attached to a block. */
function targetFor(item, scope) {
  if (item.type === "SpriteDecl") return item.name;
  if (item.type === "StageDecl") return "Stage";
  return scope.target;
}

function innermostScope(scopes, index) {
  let best = scopes[0];
  for (const scope of scopes) {
    if (index <= scope.open || index > scope.close) continue;
    if (scope.open > best.open) best = scope;
  }
  return best;
}

function collectScopes(item, scopes, target, indexes, spans) {
  // Test files never reach a built project, so their comments are dropped.
  if (!item || item.type === "TestDecl") return;

  const span = spans.get(item) || {};
  const addScope = (body, open, close, owner, scopeTarget) => {
    if (!body || !open || !close) return;
    scopes.push({
      items: body,
      open: indexes.get(open) ?? -1,
      close: indexes.get(close) ?? -1,
      owner,
      target: scopeTarget,
    });
  };

  switch (item.type) {
    case "SpriteDecl":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, item.name);
      for (const child of item.body)
        collectScopes(child, scopes, item.name, indexes, spans);
      break;
    case "StageDecl":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, "Stage");
      for (const child of item.body)
        collectScopes(child, scopes, "Stage", indexes, spans);
      break;
    case "HatDecl":
    case "FunctionDecl":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, target);
      for (const child of item.body)
        collectScopes(child, scopes, target, indexes, spans);
      break;
    case "If":
      addScope(item.then, span.bodyOpen, span.bodyClose, item, target);
      for (const child of item.then)
        collectScopes(child, scopes, target, indexes, spans);
      if (span.elseOpen) {
        addScope(item.else, span.elseOpen, span.elseClose, item, target);
      }
      for (const child of item.else || [])
        collectScopes(child, scopes, target, indexes, spans);
      break;
    case "Repeat":
    case "While":
    case "Forever":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, target);
      for (const child of item.body)
        collectScopes(child, scopes, target, indexes, spans);
      break;
    case "BlockCall":
      if (item.body) {
        addScope(item.body, span.bodyOpen, span.bodyClose, item, target);
        for (const child of item.body)
          collectScopes(child, scopes, target, indexes, spans);
      }
      if (item.else) {
        addScope(item.else, span.elseOpen, span.elseClose, item, target);
        for (const child of item.else)
          collectScopes(child, scopes, target, indexes, spans);
      }
      break;
    default:
      break;
  }
}
