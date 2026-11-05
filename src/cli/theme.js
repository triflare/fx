/**
 * Terminal theme shared by help output and the reporter.
 *
 * Colors are derived from the product palette so a rebrand reaches the CLI
 * too. Everything falls back to plain text when the stream cannot show color.
 */

import { styleText } from "node:util";
import { brandingColors } from "../brand.js";

const STATUS_COLORS = {
  success: "#34D399",
  warning: "#FBBF24",
  danger: "#F87171",
};

function rgb(hex) {
  const digits =
    hex.length === 4 ? hex.slice(1).replace(/./g, "$&$&") : hex.slice(1);
  return digits.match(/../g).map((part) => parseInt(part, 16));
}

function mix(from, to, amount) {
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  const channel = (a, b) => Math.round(a + (b - a) * amount);
  return [channel(r1, r2), channel(g1, g2), channel(b1, b2)];
}

function supportsColor(stream) {
  if (!stream?.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  return styleText("red", "x", { stream }).includes("\x1b");
}

/**
 * @param {{ product?: object, color?: "auto"|"always"|"never", stream?: NodeJS.WriteStream }} [options]
 */
export function createTheme({
  product,
  color = "auto",
  stream = process.stdout,
} = {}) {
  const palette = brandingColors(product);
  const enabled =
    color === "always" || (color !== "never" && supportsColor(stream));

  const paint = (text, codes) => {
    if (!enabled || codes.length === 0) return String(text);
    return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
  };

  const foreground = (colorValue) => {
    const [r, g, b] = Array.isArray(colorValue) ? colorValue : rgb(colorValue);
    return `38;2;${r};${g};${b}`;
  };

  const command = mix(palette.primary, "#FFFFFF", 0.35);
  const heading = mix(palette.primary, "#FFFFFF", 0.2);
  const option = mix(palette.primary, "#FFFFFF", 0.58);
  const argument = mix(palette.primary, "#FFFFFF", 0.74);

  return {
    enabled,
    stream,

    accent: (text) => paint(text, [foreground(palette.primary)]),
    command: (text) => paint(text, ["1", foreground(command)]),
    heading: (text) => paint(text, ["1", foreground(heading)]),
    option: (text) => paint(text, [foreground(option)]),
    argument: (text) => paint(text, [foreground(argument)]),
    muted: (text) => paint(text, ["2"]),
    bold: (text) => paint(text, ["1"]),
    success: (text) => paint(text, [foreground(STATUS_COLORS.success)]),
    warning: (text) => paint(text, [foreground(STATUS_COLORS.warning)]),
    danger: (text) => paint(text, [foreground(STATUS_COLORS.danger)]),

    tone(name, text) {
      const value = STATUS_COLORS[name] ?? palette.primary;
      return paint(text, [foreground(value)]);
    },
  };
}
