import { styleText } from "node:util";
import { loadProduct } from "./product.js";

// Every user-facing name, command, and filename comes from product.yml. A
// rebrand is a one-file change, and a stale literal can't survive a rename.
export function brand() {
  return loadProduct();
}

export function productName(product = brand()) {
  return product.name;
}

export function commandName(product = brand()) {
  return product.command;
}

export function productVersion(product = brand()) {
  return product.version;
}

export function configFilename(product = brand()) {
  return product.defaults?.configFilename ?? "fx.yml";
}

export function configFilenames(product = brand()) {
  const base = configFilename(product);
  if (base.endsWith(".yml")) return [base, `${base.slice(0, -4)}.yaml`];
  if (base.endsWith(".yaml")) return [base, `${base.slice(0, -5)}.yml`];
  return [base];
}

export function sourceExtension(product = brand()) {
  return product.defaults?.sourceExtension ?? ".tfx";
}

export function sourceDirectory(product = brand()) {
  return product.defaults?.sourceDirectory ?? "src";
}

export function outputDirectory(product = brand()) {
  return product.defaults?.outputDirectory ?? "build";
}

const FALLBACK_COLORS = {
  primary: "#E8590C",
  secondary: "#BA470A",
  tertiary: "#8B3507",
};

export function brandingColors(product = brand()) {
  const colors = product.branding?.colors ?? {};
  return {
    primary: colors.primary ?? FALLBACK_COLORS.primary,
    secondary: colors.secondary ?? FALLBACK_COLORS.secondary,
    tertiary: colors.tertiary ?? FALLBACK_COLORS.tertiary,
  };
}

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

// styleText only learned hex colors in Node 24.16, and engines allow any 22, so
// the truecolor escape is built here. The gate is styleText's own: ask it to
// color a marker, and stay plain when it comes back untouched.
function colorize(text, color, stream, force = false) {
  if (!HEX_COLOR.test(color)) return styleText(color, text, { stream });
  if (!force && !styleText("red", "\u0000", { stream }).includes("\u001b"))
    return text;
  const digits =
    color.length === 4 ? color.slice(1).replace(/./g, "$&$&") : color.slice(1);
  const [red, green, blue] = digits
    .match(/../g)
    .map((part) => parseInt(part, 16));
  return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
}

// Paints a product name or command in three equal bands taken straight from the
// logo palette. The colors disappear when the stream can't render them, so
// piped output and CI logs stay plain text.
export function brandText(
  text,
  stream = process.stdout,
  { force = false } = {},
) {
  const { primary, secondary, tertiary } = brandingColors();
  const palette = [primary, secondary, tertiary];
  const chars = Array.from(text);
  if (chars.length === 0) return text;

  const bandFor = (index) =>
    Math.min(
      palette.length - 1,
      Math.floor((index * palette.length) / chars.length),
    );
  const runs = [];
  let start = 0;
  for (let index = 1; index <= chars.length; index += 1) {
    if (index === chars.length || bandFor(index) !== bandFor(start)) {
      runs.push(
        colorize(
          chars.slice(start, index).join(""),
          palette[bandFor(start)],
          stream,
          force,
        ),
      );
      start = index;
    }
  }
  return runs.join("");
}
