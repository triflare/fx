/**
 * Human and JSON output for the CLI.
 *
 * Commands call semantic methods (`success`, `detail`, `warn`, ...) and never
 * write to stdout/stderr directly. In JSON mode human output is suppressed and
 * warnings are collected for the command envelope.
 */

import { styleText } from "node:util";
import { brandText } from "../brand.js";
import { createTheme } from "./theme.js";

const STATUS = {
  success: { symbol: "success", tone: "success" },
  error: { symbol: "error", tone: "danger" },
  warn: { symbol: "progress", tone: "warning" },
};

function canColor(stream) {
  return styleText("red", "x", { stream }).includes("\x1b");
}

export function createReporter({
  product,
  stdout = process.stdout,
  stderr = process.stderr,
  json = false,
  quiet = false,
  verbose = false,
  color = "auto",
} = {}) {
  const warnings = [];
  const errors = [];
  const themes = new Map();

  const themeFor = (stream) => {
    if (!themes.has(stream))
      themes.set(stream, createTheme({ product, color, stream }));
    return themes.get(stream);
  };

  const colorEnabled = (stream) => {
    if (color === "never") return false;
    if (color === "always") return true;
    return canColor(stream);
  };

  const paint = (text, tone, stream = stdout) => {
    if (!tone || !colorEnabled(stream)) return text;
    const options = { stream };
    if (color === "always") options.validateStream = false;
    return styleText(tone, text, options);
  };

  const mark = (name) => product?.symbols?.[name] ?? "";

  const status = (type, message) => {
    const { symbol, tone } = STATUS[type];
    const glyph = mark(symbol);
    const stream = type === "success" ? stdout : stderr;
    const theme = themeFor(stream);
    const text = String(message);
    const output = text
      .split("\n")
      .map((line, index) => {
        const lead =
          index === 0
            ? glyph
              ? `${theme.tone(tone, glyph)} `
              : ""
            : glyph
              ? "  "
              : "";
        const body =
          type === "success" ? theme.bold(line) : theme.tone(tone, line);
        return `${lead}${body}`;
      })
      .join("\n");
    stream.write(`${output}\n`);
  };

  const human = !json && !quiet;

  return {
    json,
    quiet,
    verbose,
    warnings,
    errors,
    paint,
    brand: (text) => brandText(text, stdout, { force: color === "always" }),
    accent: (text) => themeFor(stdout).accent(text),
    muted: (text) => themeFor(stdout).muted(text),
    bold: (text) => themeFor(stdout).bold(text),
    tone: (name, text) => themeFor(stdout).tone(name, text),

    success(message) {
      if (!human) return;
      status("success", message);
    },

    info(message) {
      if (!human) return;
      stdout.write(`${message}\n`);
    },

    bullet(message) {
      if (!human) return;
      const theme = themeFor(stdout);
      const glyph = mark("bullet");
      stdout.write(`  ${glyph ? `${theme.accent(glyph)} ` : ""}${message}\n`);
    },

    step(message) {
      if (!human) return;
      const theme = themeFor(stdout);
      const glyph = mark("progress");
      stdout.write(`${glyph ? `${theme.accent(glyph)} ` : ""}${message}\n`);
    },

    heading(message) {
      if (!human) return;
      stdout.write(`${themeFor(stdout).heading(String(message))}\n`);
    },

    /** Aligned `label  value` row used by command summaries. */
    detail(label, value, { width = 13 } = {}) {
      if (!human) return;
      const theme = themeFor(stdout);
      const text = String(value);
      const rendered = text === "(none)" ? theme.muted(text) : theme.bold(text);
      stdout.write(
        `  ${theme.muted(String(label).padEnd(width))} ${rendered}\n`,
      );
    },

    /** Aligned name + description row used by listings. */
    item(label, value = "", { width = 24, suffix = "" } = {}) {
      if (!human) return;
      const theme = themeFor(stdout);
      const text = String(label);
      const padded = text.padEnd(Math.max(width, text.length));
      const detail = value ? ` ${value}` : "";
      const note = suffix ? ` ${theme.muted(suffix)}` : "";
      stdout.write(`  ${theme.accent(padded)}${detail}${note}\n`);
    },

    /** Plain block of text with no decoration. */
    text(message) {
      if (!human) return;
      stdout.write(`${message}\n`);
    },

    /**
     * Unmodified product output, such as formatted source. Quiet does not
     * suppress it because it is the command's result; JSON mode does.
     */
    raw(text) {
      if (json) return;
      stdout.write(String(text));
    },

    /** Quiet, de-emphasized line for incidental notes. */
    note(message) {
      if (!human) return;
      stdout.write(`${themeFor(stdout).muted(message)}\n`);
    },

    warn(message) {
      const text = String(message);
      warnings.push(text);
      if (json) return;
      status("warn", text);
    },

    error(message) {
      const text = String(message);
      errors.push(text);
      if (json) return;
      status("error", text);
    },

    hint(message) {
      if (!human) return;
      const theme = themeFor(stdout);
      stdout.write(
        `  ${theme.accent("↳")} ${theme.muted(`hint: ${message}`)}\n`,
      );
    },

    /** One JSON document, used for the command result envelope. */
    document(value) {
      if (!json) return;
      stdout.write(`${JSON.stringify(value)}\n`);
    },

    /** One newline-delimited JSON event, used by long-running `dev`. */
    event(type, data = {}) {
      if (!json) return;
      stdout.write(`${JSON.stringify({ event: type, ...data })}\n`);
    },
  };
}
