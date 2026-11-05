import { completeCommand, completionCommand } from "./completion.js";
import { buildCommand } from "./build.js";
import { catalogCommand } from "./catalog.js";
import { checkCommand } from "./check.js";
import { decompileCommand } from "./decompile.js";
import { devCommand } from "./dev.js";
import { registerExtension } from "./extension.js";
import { initCommand } from "./init.js";
import { packageCommand } from "./package.js";
import { registerSprite } from "./sprite/index.js";
import { registerVendor } from "./vendor/index.js";
import { defineCommand } from "../define-command.js";

const TOP_LEVEL = [
  buildCommand,
  devCommand,
  packageCommand,
  decompileCommand,
  checkCommand,
  catalogCommand,
  initCommand,
  completionCommand,
];

/**
 * Register every command on the root program.
 *
 * @param {import("commander").Command} program
 * @param {{state: object, product: object}} options
 */
export function registerCommands(program, options) {
  program.commandsGroup("Core Commands:");
  for (const spec of TOP_LEVEL) defineCommand(program, spec, options);
  registerVendor(program, options);
  registerSprite(program, options);
  defineCommand(program, completeCommand, options);
  registerExtension(program, options);
  return program;
}
