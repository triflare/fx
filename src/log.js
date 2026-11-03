import { formatWithOptions, styleText } from "node:util";
import { brand } from "./brand.js";

// The CLI has no logging dependency, so this is the reporter. Glyphs and colors
// still come from product.yml, which keeps the terminal voice in one place.
const TYPES = {
  success: { symbol: "success", color: "green" },
  error: { symbol: "error", color: "red" },
  warn: { symbol: "progress", color: "yellow" },
};

function stringify(message) {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.stack ?? message.message;
  return formatWithOptions({ colors: false }, message);
}

// styleText's own escape for a color, so a line can be re-colored after a
// nested brand-colored word resets the foreground.
function colorOpen(color, stream) {
  const marker = "\u0000";
  const sample = styleText(color, marker, { stream });
  const index = sample.indexOf(marker);
  return index > 0 ? sample.slice(0, index) : "";
}

function paint(text, color, stream) {
  if (!color) return text;
  const open = colorOpen(color, stream);
  let painted = styleText(color, text, { stream });
  if (open) {
    painted = painted.replaceAll("\x1b[39m", `\x1b[39m${open}`);
    if (painted.endsWith(open)) painted = painted.slice(0, -open.length);
  }
  return painted;
}

export function createLogger(product = brand(), streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  const symbol = (name) => product.symbols?.[name] ?? "";

  function report(type, message) {
    const { symbol: glyph, color } = TYPES[type];
    const mark = symbol(glyph);
    const stream = type === "success" ? stdout : stderr;
    const output = stringify(message)
      .split("\n")
      .map((line) => paint(mark ? `${mark} ${line}` : line, color, stream))
      .join("\n");
    stream.write(`${output}\n`);
  }

  function mark(name, message) {
    const glyph = symbol(name);
    stdout.write(`${glyph ? `${glyph} ` : ""}${stringify(message)}\n`);
  }

  return {
    success: (message) => report("success", message),
    error: (message) => report("error", message),
    warn: (message) => report("warn", message),
    progress: (message) => mark("progress", message),
    bullet: (message) => {
      const glyph = symbol("bullet");
      stdout.write(`  ${glyph ? `${glyph} ` : ""}${stringify(message)}\n`);
    },
    info: (message) => stdout.write(`${stringify(message)}\n`),
  };
}
