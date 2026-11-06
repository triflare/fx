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
  const limit = Math.min(end, lines.length);
  for (let index = start + 1; index < limit; index++) {
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

/**
 * Remove `project.extensions` entirely (used by migration).
 *
 * Unlike {@link removeProjectExtension}, this drops the key itself instead of
 * leaving an empty list, so a fully migrated file has no legacy section left.
 */
export function removeProjectExtensions(configPath) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const project = topLevel(lines, "project");
  if (!project) return [];
  const { value: rest, comment } = splitComment(project.rest);

  if (rest.startsWith("{")) {
    if (!rest.endsWith("}"))
      throw new Error("project must be a mapping to edit it");
    const mapping = parseValue(rest);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
      throw new Error("project must be a mapping to edit it");
    if (!Object.hasOwn(mapping, "extensions")) return [];

    const removed = stringList(mapping.extensions);
    delete mapping.extensions;
    const line = lines[project.index];
    lines[project.index] =
      `project: ${JSON.stringify(mapping)}` +
      `${comment ? ` ${comment}` : ""}${ending(line) || eolOf(text)}`;
    writeDocument(configPath, lines.join(""));
    return removed;
  }

  const bounds = projectBounds(lines);
  if (!bounds) return [];
  const list = readList(lines, "extensions", bounds.index, bounds.end);
  if (!list) return [];

  const removed = [...list.values];
  if (list.style === "block") {
    const end = Math.max(list.keyLine.index, list.lastLine) + 1;
    lines.splice(list.keyLine.index, end - list.keyLine.index);
  } else {
    lines.splice(list.keyLine.index, 1);
  }
  writeDocument(configPath, lines.join(""));
  return removed;
}

// --------------------------------------------------------------- vendor edits

const SAFE_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Quote a mapping key when YAML would otherwise parse it as non-text. */
function quoteKey(key) {
  // YAML 1.1 treats bare yes/no/on/off/null as non-strings.
  return SAFE_KEY.test(key) &&
    !/^(?:y|yes|n|no|on|off|null|true|false)$/i.test(key)
    ? key
    : JSON.stringify(String(key));
}

/** Serialize one vendor entry, expanding options only when needed. */
function vendorEntryLines(name, source, options, indent, eol) {
  const extra = [];
  if (options.unsandboxed) extra.push(`${indent}  unsandboxed: true${eol}`);
  if (options.volatile !== undefined)
    extra.push(`${indent}  volatile: ${Boolean(options.volatile)}${eol}`);
  if (extra.length === 0)
    return [`${indent}${quoteKey(name)}: ${quote(source)}${eol}`];
  return [
    `${indent}${quoteKey(name)}:${eol}`,
    `${indent}  url: ${quote(source)}${eol}`,
    ...extra,
  ];
}

/** Locate a top-level mapping, accepting an inline flow mapping. */
function topLevelBounds(lines, key) {
  const found = topLevel(lines, key);
  if (!found) return null;
  const { value: rest, comment } = splitComment(found.rest);
  if (rest !== "") {
    // A flow mapping can be expanded losslessly (comments on the line aside).
    if (rest.startsWith("{") && rest.endsWith("}")) {
      const mapping = parseValue(rest);
      if (mapping && typeof mapping === "object" && !Array.isArray(mapping))
        return {
          index: found.index,
          end: found.index + 1,
          inline: rest,
          comment,
        };
    }
    throw new Error(`${key} must be a block mapping to edit it`);
  }
  return {
    index: found.index,
    end: sectionEnd(lines, found.index),
    inline: null,
    comment,
  };
}

/** Find direct child entries and their line ranges in a mapping. */
function mappingEntrySpans(lines, start, end) {
  const indent = childIndent(lines, start, end);
  const spans = [];
  const limit = Math.min(end, lines.length);
  for (let index = start + 1; index < limit; index++) {
    const text = content(lines[index]);
    if (text.trim() === "" || /^[ \t]*#/.test(text)) continue;
    const outer = /^([ \t]+)(.*)$/.exec(text);
    if (!outer || outer[1] !== indent) continue;
    const match = /^(.+?)[ \t]*:[ \t]*(.*)$/.exec(outer[2]);
    if (!match) continue;
    let key;
    try {
      const parsed = yaml.load(`${match[1]}: null`);
      key =
        parsed && typeof parsed === "object" ? Object.keys(parsed)[0] : null;
    } catch {
      continue;
    }
    if (key == null) continue;
    spans.push({ index, indent, key: String(key), rest: match[2] });
  }
  for (let index = 0; index < spans.length; index++)
    spans[index].end = index + 1 < spans.length ? spans[index + 1].index : end;
  return spans;
}

/** Replace a half-open line range in place. */
function replaceRange(lines, start, end, added) {
  lines.splice(start, end - start, ...added);
}

/**
 * Add or replace a `vendor:` entry without reformatting the rest of fx.yml.
 *
 * @param {string} configPath
 * @param {string} name
 * @param {string} source
 * @param {{unsandboxed?: boolean, volatile?: boolean}} [options]
 * @returns {{added: boolean, updated: boolean}}
 */
export function addVendorEntry(configPath, name, source, options = {}) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const eol = eolOf(text);
  const key = String(name);
  let added = false;
  let updated = false;

  const bounds = topLevelBounds(lines, "vendor");
  if (!bounds) {
    if (lines.length > 0 && !lines[lines.length - 1].endsWith("\n"))
      lines[lines.length - 1] += eol;
    lines.push(
      `vendor:${eol}`,
      ...vendorEntryLines(key, source, options, "  ", eol),
    );
    added = true;
  } else if (bounds.inline) {
    const mapping = parseValue(bounds.inline) || {};
    updated = Object.hasOwn(mapping, key);
    added = !updated;
    mapping[key] =
      options.unsandboxed || options.volatile !== undefined
        ? {
            url: source,
            ...(options.unsandboxed ? { unsandboxed: true } : {}),
            ...(options.volatile !== undefined
              ? { volatile: Boolean(options.volatile) }
              : {}),
          }
        : source;
    const dumped = yaml
      .dump({ vendor: mapping }, { lineWidth: -1, noRefs: true })
      .split("\n")
      .filter((line, index, all) => !(index === all.length - 1 && line === ""))
      .map((line) => `${line}${eol}`);
    if (bounds.comment) dumped[0] = `vendor: ${bounds.comment}${eol}`;
    replaceRange(lines, bounds.index, bounds.index + 1, dumped);
  } else {
    const spans = mappingEntrySpans(lines, bounds.index, bounds.end);
    const existing = spans.find((span) => span.key === key);
    if (existing) {
      replaceRange(
        lines,
        existing.index,
        existing.end,
        vendorEntryLines(key, source, options, existing.indent, eol),
      );
      updated = true;
    } else {
      const indent = childIndent(lines, bounds.index, bounds.end);
      insertAt(
        lines,
        bounds.end,
        vendorEntryLines(key, source, options, indent, eol),
        eol,
      );
      added = true;
    }
  }

  if (added || updated) writeDocument(configPath, lines.join(""));
  return { added, updated };
}

/**
 * Remove a `vendor:` entry.
 * @param {string} configPath
 * @param {string} name
 * @returns {{removed: string|null}}
 */
export function removeVendorEntry(configPath, name) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const eol = eolOf(text);
  const key = String(name);
  const bounds = topLevelBounds(lines, "vendor");
  if (!bounds) return { removed: null };

  if (bounds.inline) {
    const mapping = parseValue(bounds.inline);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
      return { removed: null };
    if (!Object.hasOwn(mapping, key)) return { removed: null };
    const source =
      typeof mapping[key] === "string"
        ? mapping[key]
        : (mapping[key]?.url ?? mapping[key]?.source ?? null);
    delete mapping[key];
    const rest = Object.keys(mapping).length
      ? ` ${JSON.stringify(mapping)}`
      : " {}";
    const comment = bounds.comment ? ` ${bounds.comment}` : "";
    const line = lines[bounds.index];
    lines[bounds.index] = `vendor:${rest}${comment}${
      /\r?\n$/.test(line) ? ending(line) : eol
    }`;
    writeDocument(configPath, lines.join(""));
    return { removed: source };
  }

  const spans = mappingEntrySpans(lines, bounds.index, bounds.end);
  const existing = spans.find((span) => span.key === key);
  if (!existing) return { removed: null };

  let source = null;
  try {
    const parsed = yaml.load(
      [
        content(lines[bounds.index]),
        ...lines.slice(existing.index, existing.end),
      ]
        .join("\n")
        .replace(/^vendor:/, "vendor:"),
    );
    const entry = parsed?.vendor?.[key];
    source =
      typeof entry === "string"
        ? entry
        : (entry?.url ?? entry?.source ?? entry?.path ?? null);
  } catch {
    // The entry is removed either way.
  }

  replaceRange(lines, existing.index, existing.end, []);
  const end = bounds.end - (existing.end - existing.index);
  const remaining = mappingEntrySpans(lines, bounds.index, end);
  if (remaining.length === 0) {
    replaceRange(lines, bounds.index, end, [`vendor: {}${eol}`]);
  }
  writeDocument(configPath, lines.join(""));
  return { removed: source ?? key };
}

// -------------------------------------------------------------- feature edits

/**
 * Add or replace a `features:` entry without reformatting the rest of fx.yml.
 *
 * @param {string} configPath
 * @param {string} name
 * @param {string} file
 * @returns {{added: boolean, updated: boolean}}
 */
export function addFeatureEntry(configPath, name, file) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const eol = eolOf(text);
  const key = String(name);
  let added = false;
  let updated = false;
  const entryLine = (indent) =>
    `${indent}${quoteKey(key)}: ${quote(file)}${eol}`;

  const bounds = topLevelBounds(lines, "features");
  if (!bounds) {
    if (lines.length > 0 && !lines[lines.length - 1].endsWith("\n"))
      lines[lines.length - 1] += eol;
    lines.push(`features:${eol}`, entryLine("  "));
    added = true;
  } else if (bounds.inline) {
    const mapping = parseValue(bounds.inline) || {};
    updated = Object.hasOwn(mapping, key);
    added = !updated;
    mapping[key] = file;
    const dumped = yaml
      .dump({ features: mapping }, { lineWidth: -1, noRefs: true })
      .split("\n")
      .filter((line, index, all) => !(index === all.length - 1 && line === ""))
      .map((line) => `${line}${eol}`);
    if (bounds.comment) dumped[0] = `features: ${bounds.comment}${eol}`;
    replaceRange(lines, bounds.index, bounds.index + 1, dumped);
  } else {
    const spans = mappingEntrySpans(lines, bounds.index, bounds.end);
    const existing = spans.find((span) => span.key === key);
    if (existing) {
      replaceRange(lines, existing.index, existing.end, [
        entryLine(existing.indent),
      ]);
      updated = true;
    } else {
      const indent = childIndent(lines, bounds.index, bounds.end);
      insertAt(lines, bounds.end, [entryLine(indent)], eol);
      added = true;
    }
  }

  if (added || updated) writeDocument(configPath, lines.join(""));
  return { added, updated };
}

/**
 * Remove a `features:` entry.
 * @param {string} configPath
 * @param {string} name
 * @returns {{removed: string|null}}
 */
export function removeFeatureEntry(configPath, name) {
  const text = fs.readFileSync(configPath, "utf8");
  const lines = splitLines(text);
  const eol = eolOf(text);
  const key = String(name);
  const bounds = topLevelBounds(lines, "features");
  if (!bounds) return { removed: null };

  if (bounds.inline) {
    const mapping = parseValue(bounds.inline);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
      return { removed: null };
    if (!Object.hasOwn(mapping, key)) return { removed: null };
    const source = mapping[key];
    delete mapping[key];
    const rest = Object.keys(mapping).length
      ? ` ${JSON.stringify(mapping)}`
      : " {}";
    const comment = bounds.comment ? ` ${bounds.comment}` : "";
    const line = lines[bounds.index];
    lines[bounds.index] = `features:${rest}${comment}${
      /\r?\n$/.test(line) ? ending(line) : eol
    }`;
    writeDocument(configPath, lines.join(""));
    return { removed: source == null ? null : String(source) };
  }

  const spans = mappingEntrySpans(lines, bounds.index, bounds.end);
  const existing = spans.find((span) => span.key === key);
  if (!existing) return { removed: null };

  let source = null;
  try {
    const parsed = yaml.load(
      [
        content(lines[bounds.index]),
        ...lines.slice(existing.index, existing.end),
      ].join("\n"),
    );
    const entry = parsed?.features?.[key];
    source =
      typeof entry === "string" ? entry : (entry?.file ?? entry?.path ?? null);
  } catch {
    // The entry is removed either way.
  }

  replaceRange(lines, existing.index, existing.end, []);
  const end = bounds.end - (existing.end - existing.index);
  const remaining = mappingEntrySpans(lines, bounds.index, end);
  if (remaining.length === 0) {
    replaceRange(lines, bounds.index, end, [`features: {}${eol}`]);
  }
  writeDocument(configPath, lines.join(""));
  return { removed: source ?? key };
}
