/**
 * Test-file glob matching.
 *
 * Kept free of Node built-ins so the browser-safe linter can share the same
 * matcher as `fx test`, the build, and the VS Code extension.
 */

/** Default test-file glob, relative to the project directory. */
export const DEFAULT_TEST_PATTERN = "test/**/*.test.tfx";

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/** Escape regular-expression syntax so a glob is matched literally. */
function escapeRegex(text) {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

/**
 * Translate a small glob (`**`, `*`, `?`) into an anchored regular expression.
 * A double star followed by a slash also matches zero directories, so
 * `test/**\/*.test.tfx` matches `test/score.test.tfx`.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const normalized = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether a project-relative path (posix separators) is a test file.
 * @param {string} relativePath
 * @param {string} [pattern]
 */
export function matchesTestPattern(
  relativePath,
  pattern = DEFAULT_TEST_PATTERN,
) {
  const normalized = String(relativePath).replace(/\\/g, "/");
  return globToRegExp(pattern).test(normalized);
}

/**
 * Whether `file` matches `pattern` relative to `root`.
 *
 * `root` may be absent, in which case the path is matched as given. Both
 * separators are accepted so callers can pass filesystem paths or URIs.
 *
 * @param {string} file
 * @param {string|null|undefined} root
 * @param {string} [pattern]
 */
export function isTestPath(file, root, pattern = DEFAULT_TEST_PATTERN) {
  if (!pattern) return false;
  const normalized = String(file).replace(/\\/g, "/");
  const base = root ? String(root).replace(/\\/g, "/").replace(/\/+$/, "") : "";
  const relative =
    base && normalized.startsWith(`${base}/`)
      ? normalized.slice(base.length + 1)
      : normalized;
  return matchesTestPattern(relative, pattern);
}
