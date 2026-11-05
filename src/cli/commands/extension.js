import path from "node:path";
import { Command } from "commander";
import {
  addProjectExtension,
  findConfigPath,
  readProjectExtensions,
  removeProjectExtension,
} from "../../config.js";
import { defineCommand } from "../define-command.js";
import { UsageError } from "../errors.js";

function requireConfigPath(cwd, product) {
  const found = findConfigPath(cwd);
  if (!found)
    throw new UsageError("No project config found.", {
      hint: `run "${product.command} init" first`,
    });
  return found;
}

function deprecation(reporter, product) {
  reporter.warn(
    `"${product.command} extension ..." is deprecated and will be removed in a future major version.`,
  );
  reporter.hint(
    `run "${product.command} vendor migrate", then use "${product.command} vendor ..." commands`,
  );
}

const extensionAddCommand = {
  name: "add",
  summary: "Add a legacy project.extensions entry",
  arguments: ["<source>"],
  options: [
    {
      flags: "--unsandboxed <id>",
      description: "Allow an extension id to run unsandboxed",
    },
  ],
  run({ args, options, cwd, reporter, product }) {
    deprecation(reporter, product);
    const source = args[0];
    const configPath = requireConfigPath(cwd, product);
    const unsandboxed =
      typeof options.unsandboxed === "string" ? options.unsandboxed : null;
    const result = addProjectExtension(configPath, source, { unsandboxed });
    if (result.added)
      reporter.success(`Added ${source} to ${path.basename(configPath)}`);
    else
      reporter.info(
        `${source} is already listed in ${path.basename(configPath)}`,
      );
    if (unsandboxed && result.unsandboxedAdded)
      reporter.success(`Allowed ${unsandboxed} to run unsandboxed`);
    return { source, config: configPath, ...result };
  },
};

const extensionRemoveCommand = {
  name: "remove",
  summary: "Remove a legacy project.extensions entry",
  arguments: ["<source|id>"],
  run({ args, cwd, reporter, product }) {
    deprecation(reporter, product);
    const target = args[0];
    const configPath = requireConfigPath(cwd, product);
    const result = removeProjectExtension(configPath, target);
    if (result.extensions.length > 0)
      reporter.success(
        `Removed ${result.extensions.join(", ")} from ${path.basename(configPath)}`,
      );
    if (result.unsandboxedRemoved)
      reporter.success(`Removed ${target} from the unsandboxed list`);
    return { target, config: configPath, ...result };
  },
};

const extensionListCommand = {
  name: "list",
  summary: "List legacy project.extensions entries",
  run({ cwd, reporter, product }) {
    deprecation(reporter, product);
    const configPath = requireConfigPath(cwd, product);
    const { extensions, unsandboxed } = readProjectExtensions(configPath);
    reporter.heading(
      `${path.basename(configPath)}: ${extensions.length} extension(s)`,
    );
    for (const entry of extensions) reporter.item(entry, "", { width: 0 });
    reporter.detail("Unsandboxed", unsandboxed.join(", ") || "(none)", {
      width: 12,
    });
    return { extensions, unsandboxed };
  },
};

export function registerExtension(program, options) {
  const extension = new Command("extension")
    .description("Deprecated legacy project.extensions commands.")
    .helpGroup("Legacy Commands:");
  extension.copyInheritedSettings(program);
  extension.action(() => extension.outputHelp());
  program.addCommand(extension, { hidden: true });
  for (const spec of [
    extensionAddCommand,
    extensionRemoveCommand,
    extensionListCommand,
  ])
    defineCommand(extension, spec, options);
  return extension;
}
