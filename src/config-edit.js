/**
 * Comment-preserving edits to `fx.yml`.
 *
 * Parsing and re-dumping YAML loses comments and reformats the whole file, so
 * these helpers edit only the `project.extensions` and `project.unsandboxed`
 * entries. Everything else stays byte for byte as written.
 */
import fs from "node:fs";
import * as yaml from "js-yaml";

function splitLines(text) {
  return text.split(/(?<=\n)/);
}

function content(line) {
  return line.replace(/\r?\n$/, "");
}

function ending(line) {
  return /\r?\n$/.exec(line)?.[0] ?? "";
}

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function topLevel(lines, key) {
  const pattern = new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`);
  for (let index = 0; index < lines.length; index++) {
    const match = pattern.exec(content(lines[index]));
    if (match) return { index, rest: match[1] };
  }
  return null;
}

function sectionEnd(lines, start) {
  let end = start + 1;
  for (let index = start + 1; index < lines.length; index++) {
    const text = content(lines[index]);
    if (text.trim() === "") continue;
    if (!/^[ \t]/.test(text)) break;
    end = index + 1;
  }
  return end;
}

function childKey(lines, start, end, key) {
  const pattern = new RegExp(`^([ \\t]+)${key}[ \\t]*:[ \\t]*(.*)$`);
  for (let index = start + 1; index < end; index++) {
    const match = pattern.exec(content(lines[index]));
    if (match) return { index, indent: match[1], rest: match[2] };
  }
  return null;
}

function childIndent(lines, start, end) {
  for (let index = start + 1; index < end; index++) {
    const match = /^([ \t]+)\S/.exec(content(lines[index]));
    if (match) return match[1];
  }
  return "  ";
}

function projectBounds(lines) {
  const project = topLevel(lines, "project");
  if (!project) return null;
  if (project.rest.trim() !== "" && !project.rest.trim().startsWith("#"))
    throw new Error("project must be a block mapping to edit it");
  return { index: project.index, end: sectionEnd(lines, project.index) };
}

/** Split `value # comment` at the first unquoted comment marker. */
function splitComment(rest) {
  let quote = null;
  for (let index = 0; index < rest.length; index++) {
    const char = rest[index];
    if (quote === '"') {
      if (char === "\\") index++;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && rest[index + 1] === "'") index++;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(rest[index - 1]))) {
      return {
        value: rest.slice(0, index).trimEnd(),
        comment: rest.slice(index).trimEnd(),
      };
    }
  }
  return { value: rest.trimEnd(), comment: "" };
}

function parseValue(text) {
  try {
    return yaml.load(text);
  } catch {
    return text;
  }
}

function quote(value) {
  return JSON.stringify(String(value));
}

function readList(lines, key, start, end) {
  const keyLine = childKey(lines, start, end, key);
  if (!keyLine) return null;
  const { value: raw, comment } = splitComment(keyLine.rest);

  if (raw.startsWith("[")) {
    if (!raw.trimEnd().endsWith("]"))
      throw new Error(
        `Multi-line ${key} lists are not supported; edit them by hand`,
      );
    const parsed = parseValue(raw);
    return {
      keyLine,
      style: "inline",
      values: Array.isArray(parsed) ? parsed.map(String) : [],
      comment,
    };
  }

  if (raw !== "") {
    const parsed = parseValue(raw);
    return {
      keyLine,
      style: "inline",
      values: parsed == null ? [] : [String(parsed)],
      comment,
    };
  }

  const items = [];
  let itemIndent = null;
  let lastLine = keyLine.index;
  for (let index = keyLine.index + 1; index < end; index++) {
    const text = content(lines[index]);
    if (text.trim() === "") continue;
    if (/^[ \t]*#/.test(text)) {
      // A comment above the first item belongs to the list.
      if (items.length === 0) lastLine = index;
      continue;
    }
    const match = /^([ \t]*)-[ \t]*(.*)$/.exec(text);
    if (!match || match[1].length <= keyLine.indent.length) break;
    itemIndent ??= match[1];
    if (match[1] !== itemIndent) break;
    const value = splitComment(match[2]).value;
    items.push({ value: String(parseValue(value) ?? ""), line: index });
    lastLine = index;
  }

  return {
    keyLine,
    style: "block",
    values: items.map((item) => item.value),
    items,
    itemIndent: itemIndent ?? `${keyLine.indent}  `,
    lastLine,
    comment,
  };
}

function insertAt(lines, index, added, eol) {
  if (index > 0 && !lines[index - 1].endsWith("\n")) lines[index - 1] += eol;
  lines.splice(index, 0, ...added);
}

function addValue(lines, key, value, eol) {
  const bounds = projectBounds(lines);
  if (!bounds) {
    if (lines.length > 0 && !lines[lines.length - 1].endsWith("\n"))
      lines[lines.length - 1] += eol;
    lines.push(
      `project:${eol}`,
      `  ${key}:${eol}`,
      `  - ${quote(value)}${eol}`,
    );
    return true;
  }

  const list = readList(lines, key, bounds.index, bounds.end);
  if (list && list.values.includes(value)) return false;

  if (!list) {
    const indent = childIndent(lines, bounds.index, bounds.end);
    insertAt(
      lines,
      bounds.end,
      [`${indent}${key}:${eol}`, `${indent}  - ${quote(value)}${eol}`],
      eol,
    );
    return true;
  }

  if (list.style === "block") {
    insertAt(
      lines,
      list.lastLine + 1,
      [`${list.itemIndent}- ${quote(value)}${eol}`],
      eol,
    );
    return true;
  }

  const line = lines[list.keyLine.index];
  lines[list.keyLine.index] =
    `${list.keyLine.indent}${key}: [${[...list.values, value]
      .map(quote)
      .join(", ")}]` +
    `${list.comment ? ` ${list.comment}` : ""}${ending(line) || eol}`;
  return true;
}

function removeValue(lines, key, matches) {
  const bounds = projectBounds(lines);
  if (!bounds) return [];
  const list = readList(lines, key, bounds.index, bounds.end);
  if (!list) return [];

  const removed = list.values.filter((value) => matches(value));
  if (removed.length === 0) return [];

  if (list.style === "block") {
    const doomed = list.items
      .filter((item) => matches(item.value))
      .map((item) => item.line)
      .sort((a, b) => b - a);
    for (const line of doomed) lines.splice(line, 1);
    if (list.items.length === doomed.length) {
      const line = lines[list.keyLine.index];
      lines[list.keyLine.index] =
        `${list.keyLine.indent}${key}: []` +
        `${list.comment ? ` ${list.comment}` : ""}${ending(line) || "\n"}`;
    }
    return removed;
  }

  const kept = list.values.filter((value) => !matches(value));
  const line = lines[list.keyLine.index];
  lines[list.keyLine.index] =
    `${list.keyLine.indent}${key}: [${kept.map(quote).join(", ")}]` +
    `${list.comment ? ` ${list.comment}` : ""}${ending(line) || "\n"}`;
  return removed;
}

function writeDocument(configPath, text) {
  try {
    yaml.load(text);
  } catch (error) {
    throw new Error(`Refusing to write invalid YAML: ${error.message}`, {
      cause: error,
    });
  }
  fs.writeFileSync(configPath, text);
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value != null) return [String(value)];
  return [];
}

/** Basename of an extension path or URL, without `.js`, used as its id. */
export function extensionKey(source) {
  const clean = String(source).split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || "";
  return base.replace(/\.js$/i, "");
}

/** Read the extension lists without normalising the rest of the config. */
export function readProjectExtensions(configPath) {
  const raw = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("fx.yml must contain a mapping at the top level");
  const project =
    raw.project && typeof raw.project === "object" ? raw.project : {};
  return {
    extensions: stringList(project.extensions),
    unsandboxed: stringList(project.unsandboxed),
  };
}

/**
 * Add an extension source to `project.extensions`, and optionally its id to
 * `project.unsandboxed`.
 * @returns {{added: boolean, unsandboxedAdded: boolean}}
 */
export function addProjectExtension(configPath, source, { unsandboxed } = {}) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const eol = eolOf(text);

  const added = addValue(lines, "extensions", source, eol);
  const unsandboxedAdded = unsandboxed
    ? addValue(lines, "unsandboxed", unsandboxed, eol)
    : false;
  if (added || unsandboxedAdded) writeDocument(configPath, lines.join(""));
  return { added, unsandboxedAdded };
}

/**
 * Remove an extension by its source, path/URL basename, or unsandboxed id.
 * @returns {{extensions: string[], unsandboxedRemoved: boolean}}
 */
export function removeProjectExtension(configPath, target) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);

  const removed = removeValue(
    lines,
    "extensions",
    (entry) => entry === target || extensionKey(entry) === target,
  );
  const removedKeys = new Set(removed.map(extensionKey));
  const unsandboxedRemoved = removeValue(
    lines,
    "unsandboxed",
    (id) => id === target || removedKeys.has(id),
  );
  if (removed.length === 0 && unsandboxedRemoved.length === 0)
    throw new Error(`No extension matching ${JSON.stringify(target)}`);

  writeDocument(configPath, lines.join(""));
  return {
    extensions: removed,
    unsandboxedRemoved: unsandboxedRemoved.length > 0,
  };
}
