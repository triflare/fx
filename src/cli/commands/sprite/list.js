import path from "node:path";
import { spriteGroups } from "./helpers.js";

export const spriteListCommand = {
  name: "list",
  summary: "List declared sprites",
  description: "List every sprite declared under a directory.",
  arguments: ["[dir]"],
  examples: ["fx sprite list", "fx sprite list src --json"],
  run({ args, cwd, reporter }) {
    const dir = path.resolve(cwd, args[0] || ".");
    const sprites = spriteGroups(dir);
    if (sprites.length === 0) {
      reporter.info(`No sprites under ${dir}`);
    } else {
      for (const { name, files } of sprites)
        reporter.item(
          name,
          files.map((file) => path.relative(dir, file) || file).join(", "),
          { width: 24 },
        );
    }

    return sprites.map(({ name, file, files, partial }) => ({
      name,
      file: path.relative(dir, file),
      files: files.map((entry) => path.relative(dir, entry)),
      partial,
    }));
  },
};
