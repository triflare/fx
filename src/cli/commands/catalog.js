import { CATALOG, blockNames } from "../../catalog.js";
import { loadProjectState } from "../context.js";

export const catalogCommand = {
  name: "catalog",
  aliases: ["l", "blocks"],
  group: "Core Commands:",
  summary: "List available blocks",
  description: `List block names, including blocks from extensions configured in the
project.`,
  arguments: ["[dir]"],
  examples: ["fx catalog", "fx catalog --json"],
  async run({ args, cwd, options, reporter, product, prompts }) {
    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      prompts,
    });
    const merged = { ...CATALOG, ...state.catalog };
    const names = Object.keys(merged).sort();
    const builtIn = blockNames().length;

    reporter.heading(
      `${product.name} catalog (${names.length} blocks` +
        (names.length > builtIn
          ? `, ${names.length - builtIn} from extensions`
          : "") +
        "):",
    );
    for (const name of names) {
      const entry = merged[name];
      reporter.item(name, `-> ${entry.opcode} [${entry.kind}]`, {
        width: 32,
        suffix: entry.extension ? `(ext ${entry.extension})` : "",
      });
    }

    return merged;
  },
};
