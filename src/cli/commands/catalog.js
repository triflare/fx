import { CATALOG } from "../../catalog.js";
import { loadProjectState } from "../context.js";
import { plural, terminalColumns } from "../format.js";

// Language order for the built-in categories; extension groups follow
// alphabetically so their blocks stay together at the end of the listing.
const CATEGORY_ORDER = [
  "motion",
  "looks",
  "sound",
  "sensing",
  "operators",
  "control",
  "events",
  "data",
];

// One-character kind marker, so a name alone still says how the block is used.
const KIND_MARKS = {
  command: " ",
  reporter: "→",
  boolean: "?",
  hat: "▸",
};

/** `SCREAMING_SNAKE_CASE` name for a catalog argument. */
function argumentName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

/** Positional arguments a block takes, in the order the compiler fills them. */
function argumentNames(entry) {
  // `pm.*` are argument reporters whose VALUE field is the reporter's own
  // label ("is compiled?"), not a parameter the caller supplies.
  if (entry.opcode?.startsWith("argument_reporter")) return [];
  if (entry.kind === "hat")
    return (entry.args || []).map((arg) => arg.field || arg.input);
  return [
    ...Object.keys(entry.fields || {}),
    ...Object.entries(entry.inputs || {})
      .filter(([, spec]) => spec.type !== "substack")
      .map(([name]) => name),
  ];
}

/** `category.block(ARG, ...)` call shape shown in the listing. */
function signature(name, entry) {
  const args = argumentNames(entry).map(argumentName);
  return `${name}(${args.join(", ")})`;
}

function mark(entry) {
  return KIND_MARKS[entry.kind] ?? " ";
}

/** Group block names by category, in reading order. */
function groupNames(names) {
  const groups = new Map();
  for (const name of names) {
    const group = name.split(".")[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(name);
  }
  const rank = (group) => {
    const index = CATEGORY_ORDER.indexOf(group);
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  return new Map(
    [...groups.entries()].sort(
      ([left], [right]) =>
        rank(left) - rank(right) || left.localeCompare(right),
    ),
  );
}

export const catalogCommand = {
  name: "catalog",
  aliases: ["l", "blocks"],
  group: "Core Commands:",
  summary: "List available blocks",
  description: `List block names grouped by category, including blocks from extensions
configured in the project.`,
  arguments: ["[dir]"],
  options: [
    {
      flags: "--category <name>",
      description: "Only list one category, such as motion or pen",
    },
    {
      flags: "--search <text>",
      description: "Only list blocks whose name contains the text",
    },
  ],
  examples: [
    "fx catalog",
    "fx catalog --category motion",
    "fx catalog --search glide",
  ],
  async run({ args, cwd, options, reporter, product, prompts }) {
    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      prompts,
    });
    const merged = { ...CATALOG, ...state.catalog };
    const category =
      typeof options.category === "string"
        ? options.category.toLowerCase()
        : null;
    const search =
      typeof options.search === "string" ? options.search.toLowerCase() : null;
    const names = Object.keys(merged)
      .filter(
        (name) => !category || name.split(".")[0].toLowerCase() === category,
      )
      .filter((name) => !search || name.toLowerCase().includes(search))
      .sort();
    const selected = Object.fromEntries(
      names.map((name) => [name, merged[name]]),
    );

    if (names.length === 0) {
      const filters = [
        category && `--category "${options.category}"`,
        search && `--search "${options.search}"`,
      ]
        .filter(Boolean)
        .join(" and ");
      reporter.info(`No blocks match ${filters}.`);
      reporter.hint(`run "${product.command} catalog" to see every block`);
      return selected;
    }

    const groups = groupNames(names);
    let title = `${product.name} catalog — ${plural(names.length, "block")}`;
    if (category) title += ` · ${category}`;
    else if (search) title += ` matching "${options.search}"`;
    else title += ` in ${plural(groups.size, "group")}`;
    reporter.heading(title);
    if (!category && !search)
      reporter.hint("narrow with --category <name> or --search <text>");

    const width = terminalColumns();
    for (const [group, entries] of groups) {
      reporter.text("");
      reporter.item(group, "", { width: 0, suffix: `· ${entries.length}` });
      if (reporter.verbose) {
        for (const name of entries) {
          const entry = merged[name];
          reporter.item(
            `${mark(entry)} ${signature(name, entry)}`,
            `-> ${entry.opcode} [${entry.kind}]`,
            {
              width: 44,
              suffix: entry.extension ? `(ext ${entry.extension})` : "",
            },
          );
        }
      } else {
        reporter.columns(
          entries.map(
            (name) => `${mark(merged[name])} ${signature(name, merged[name])}`,
          ),
          { width },
        );
      }
    }

    return selected;
  },
};
