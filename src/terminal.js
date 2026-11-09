/**
 * Terminal output safety.
 *
 * Names, paths and source text can come from a repository the user did not
 * write, so untrusted text is rendered with visible `\xNN` escapes instead of
 * letting the terminal interpret control characters and escape sequences.
 */

/**
 * Replace terminal control characters with visible `\xNN` escapes.
 *
 * Tabs and newlines are kept because callers print multi-line blocks.
 * @param {unknown} value
 */
export function sanitizeTerminalText(value) {
  let clean = "";
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    const printable =
      code === 0x09 ||
      code === 0x0a ||
      (code >= 0x20 && code <= 0x7e) ||
      code >= 0xa0;
    clean += printable ? char : `\\x${code.toString(16).padStart(2, "0")}`;
  }
  return clean;
}
