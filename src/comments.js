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
        stage: true,
      },
    ];
    for (const item of programItems)
      collectScopes(item, scopes, "Stage", true, indexes, spans);

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

  function addStandalone(text, target, stage) {
    // `""` is a valid sprite name, so only a missing target falls back to the
    // stage in the compiler; an empty name must still resolve through byName.
    if (target != null) standalone.push({ text, target, stage });
  }

  /** Sibling items ordered by source position, built once per scope. */
  function orderedItems(scope, indexes) {
    if (scope.entries) return scope.entries;
    const entries = scope.items
      .map((item) => ({ item, index: indexes.get(item.loc) }))
      .filter((entry) => entry.index !== undefined)
      .sort((a, b) => a.index - b.index);
    // An item ends at the last token before the next item (or the scope's
    // closing brace), so a trailing comment on a multiline item is still on
    // that item's line.
    for (let i = 0; i < entries.length; i++) {
      const end = i + 1 < entries.length ? entries[i + 1].index : scope.close;
      const token = tokens[Math.max(0, end - 1)];
      entries[i].endLine = token ? token.line : entries[i].item.loc.line;
    }
    scope.entries = entries;
    return entries;
  }

  /** First position in the ordered entries whose token index is >= `index`. */
  function lowerBound(entries, index) {
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (entries[mid].index < index) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function placeComment(program, scope, comment, text, indexes) {
    // Comments inside a test body are dropped with the rest of the test.
    if (scope.drop) return;
    const entries = orderedItems(scope, indexes);
    const position = lowerBound(entries, comment.after);

    // A comment after code on the same line belongs to that code, including
    // when the code spans several lines.
    for (let i = position - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.endLine !== comment.line) break;
      return place(program, scope, entry.item, text);
    }

    const next = entries[position];
    if (next) return place(program, scope, next.item, text);

    // Nothing follows in a block body: the comment describes the block.
    if (scope.owner && BLOCK_OWNERS.has(scope.owner.type))
      return place(program, scope, scope.owner, text);

    const previous = entries[position - 1];
    if (previous) return place(program, scope, previous.item, text);

    // An empty body: the comment describes the block or sprite that owns it.
    if (scope.owner) return place(program, scope, scope.owner, text);
    addStandalone(text, scope.target, scope.stage);
  }

  function place(program, scope, item, text) {
    if (item.type === "TestDecl") return;
    if (BLOCK_OWNERS.has(item.type)) {
      item.comments = item.comments || [];
      item.comments.push(text);
      return;
    }
    if (item.type === "SpriteDecl")
      return addStandalone(text, item.name, false);
    if (item.type === "StageDecl") return addStandalone(text, "Stage", true);
    addStandalone(text, scope.target, scope.stage);
  }
}

function innermostScope(scopes, index) {
  let best = scopes[0];
  for (const scope of scopes) {
    if (index <= scope.open || index > scope.close) continue;
    if (scope.open > best.open) best = scope;
  }
  return best;
}

function collectScopes(item, scopes, target, stage, indexes, spans) {
  if (!item) return;

  const span = spans.get(item) || {};
  const addScope = (
    body,
    open,
    close,
    owner,
    scopeTarget,
    scopeStage,
    drop = false,
  ) => {
    if (!body || !open || !close) return;
    scopes.push({
      items: body,
      open: indexes.get(open) ?? -1,
      close: indexes.get(close) ?? -1,
      owner,
      target: scopeTarget,
      stage: scopeStage,
      drop,
    });
  };

  // Test files never reach a built project, so their comments are dropped.
  // Their braces are still registered as a scope so comments inside a test
  // body cannot attach to declarations around it.
  if (item.type === "TestDecl") {
    addScope(
      item.body,
      span.bodyOpen,
      span.bodyClose,
      item,
      target,
      stage,
      true,
    );
    return;
  }

  switch (item.type) {
    case "SpriteDecl":
      addScope(
        item.body,
        span.bodyOpen,
        span.bodyClose,
        item,
        item.name,
        false,
      );
      for (const child of item.body)
        collectScopes(child, scopes, item.name, false, indexes, spans);
      break;
    case "StageDecl":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, "Stage", true);
      for (const child of item.body)
        collectScopes(child, scopes, "Stage", true, indexes, spans);
      break;
    case "HatDecl":
    case "FunctionDecl":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, target, stage);
      for (const child of item.body)
        collectScopes(child, scopes, target, stage, indexes, spans);
      break;
    case "If":
      addScope(item.then, span.bodyOpen, span.bodyClose, item, target, stage);
      for (const child of item.then)
        collectScopes(child, scopes, target, stage, indexes, spans);
      if (span.elseOpen) {
        addScope(item.else, span.elseOpen, span.elseClose, item, target, stage);
      }
      for (const child of item.else || [])
        collectScopes(child, scopes, target, stage, indexes, spans);
      break;
    case "Repeat":
    case "While":
    case "Forever":
      addScope(item.body, span.bodyOpen, span.bodyClose, item, target, stage);
      for (const child of item.body)
        collectScopes(child, scopes, target, stage, indexes, spans);
      break;
    case "BlockCall":
      if (item.body) {
        addScope(item.body, span.bodyOpen, span.bodyClose, item, target, stage);
        for (const child of item.body)
          collectScopes(child, scopes, target, stage, indexes, spans);
      }
      if (item.else) {
        addScope(item.else, span.elseOpen, span.elseClose, item, target, stage);
        for (const child of item.else)
          collectScopes(child, scopes, target, stage, indexes, spans);
      }
      break;
    default:
      break;
  }
}
