import { Command } from "commander";
import { defineCommand } from "../../define-command.js";
import { spriteAddCommand } from "./add.js";
import { spriteBuildCommand } from "./build.js";
import { spriteListCommand } from "./list.js";
import { spriteRemoveCommand } from "./remove.js";

const SUBCOMMANDS = [
  spriteAddCommand,
  spriteBuildCommand,
  spriteRemoveCommand,
  spriteListCommand,
];

export function registerSprite(program, options) {
  const sprite = new Command("sprite")
    .description("Import, build, list, and remove sprites.")
    .helpGroup("Extension Commands:");
  sprite.copyInheritedSettings(program);
  sprite.addHelpText(
    "after",
    `\nExamples:\n  fx sprite add robot.sprite3\n  fx sprite build Cat\n  fx sprite list --json\n`,
  );
  sprite.action(() => sprite.outputHelp());
  program.addCommand(sprite);

  for (const spec of SUBCOMMANDS) defineCommand(sprite, spec, options);
  return sprite;
}
