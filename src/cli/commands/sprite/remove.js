import fs from "node:fs";
import path from "node:path";
import { parse } from "../../../parser.js";
import { CliError } from "../../errors.js";
import { spriteNames } from "./helpers.js";

export const spriteRemoveCommand = {
  name: "remove",
  summary: "Delete files that declare only one sprite",
  description: `Delete the source file(s) that declare a sprite. Files that also
contain other code are refused.`,
  arguments: ["<name>"],
  examples: ["fx sprite remove Cat"],
  async run({ args, cwd, reporter, prompts, yes }) {
    const name = args[0];
    const matches = spriteNames(cwd).filter((entry) => entry.name === name);
    if (matches.length === 0)
      throw new CliError(
        `No sprite named ${JSON.stringify(name)} under ${cwd}`,
        { code: "SPRITE_NOT_FOUND" },
      );

    const files = [...new Set(matches.map((entry) => entry.file))];
    for (const file of files) {
      const ast = parse(fs.readFileSync(file, "utf8"), file);
      const onlyThisSprite =
        ast.sprites.length > 0 &&
        ast.sprites.every((sprite) => sprite.name === name) &&
        ast.topItems.length === 0 &&
        !ast.stage;
      if (!onlyThisSprite)
        throw new CliError(
          `${file} also declares other code; remove the sprite block by hand`,
          { code: "SPRITE_SHARED_FILE" },
        );
    }

    await prompts.confirmDestructive({
      message: `Delete ${files.length} file(s) for sprite ${JSON.stringify(name)}?`,
      yes,
    });

    for (const file of files) fs.rmSync(file);
    reporter.success(
      `Removed sprite ${name} (${files
        .map((file) => path.relative(cwd, file) || file)
        .join(", ")})`,
    );
    return { name, files };
  },
};
