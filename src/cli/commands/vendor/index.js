import { Command } from "commander";
import { defineCommand } from "../../define-command.js";
import { vendorAddCommand } from "./add.js";
import { vendorInstallCommand } from "./install.js";
import { vendorListCommand } from "./list.js";
import { vendorMigrateCommand } from "./migrate.js";
import { vendorOutdatedCommand } from "./outdated.js";
import { vendorRemoveCommand } from "./remove.js";
import { vendorUpdateCommand } from "./update.js";
import { vendorVerifyCommand } from "./verify.js";

const SUBCOMMANDS = [
  vendorAddCommand,
  vendorInstallCommand,
  vendorUpdateCommand,
  vendorOutdatedCommand,
  vendorVerifyCommand,
  vendorRemoveCommand,
  vendorListCommand,
  vendorMigrateCommand,
];

export function registerVendor(program, options) {
  const vendor = new Command("vendor")
    .description(
      "Copy extensions into the vendor directory and load them from there.",
    )
    .helpGroup("Extension Commands:");
  vendor.copyInheritedSettings(program);
  vendor.addHelpText(
    "after",
    `\nExamples:\n  fx vendor add https://example.com/ext.js --as ext\n  fx vendor install\n  fx vendor update --dry-run\n`,
  );
  vendor.action(() => vendor.outputHelp());
  program.addCommand(vendor);

  for (const spec of SUBCOMMANDS) defineCommand(vendor, spec, options);
  return vendor;
}
