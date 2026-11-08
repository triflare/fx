/** Small formatting helpers shared by CLI commands. */

/** Render a byte count using binary units. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

/** Render a duration in milliseconds. */
export function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

/** Pluralize a simple English noun. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Shorten long text for inline diagnostics. */
export function truncate(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Usable terminal width, clamped so narrow and huge terminals stay readable. */
export function terminalColumns(
  stream = process.stdout,
  { fallback = 80, min = 40, max = 120 } = {},
) {
  const width = stream?.columns;
  if (!Number.isFinite(width) || width <= 0) return fallback;
  return Math.min(max, Math.max(min, width));
}

/**
 * Lay items out in aligned columns that fit `width`. Entries wider than one
 * cell get a line of their own, so a single long name does not collapse the
 * whole listing into one column. Trailing whitespace is removed.
 */
export function formatColumns(
  items,
  { width = 80, indent = 2, gap = 2, cellWidth = 38 } = {},
) {
  if (items.length === 0) return [];
  const available = Math.max(width - indent, 1);
  const columns = Math.max(
    1,
    Math.min(4, Math.floor((available + gap) / (cellWidth + gap))),
  );
  const cell = Math.floor((available - gap * (columns - 1)) / columns);
  const lines = [];
  let row = [];

  const flush = () => {
    if (row.length === 0) return;
    const cells = row.map((text, index) =>
      index === row.length - 1 ? text : text.padEnd(cell),
    );
    lines.push(`${" ".repeat(indent)}${cells.join(" ".repeat(gap))}`.trimEnd());
    row = [];
  };

  for (const item of items) {
    const text = String(item);
    if (text.length > cell) {
      flush();
      lines.push(`${" ".repeat(indent)}${text}`);
      continue;
    }
    row.push(text);
    if (row.length === columns) flush();
  }
  flush();
  return lines;
}
