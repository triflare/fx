import path from "node:path";
import { migrateProjectExtensions } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorMigrateCommand = {
  name: "migrate",
  summary: "Move project.extensions under vendor:",
  description: `Move legacy project.extensions entries into the vendor system,
writing a .bak copy of the config first.`,
  examples: ["fx vendor migrate", "fx vendor migrate --yes"],
  async run({ cwd, reporter, prompts, yes, product }) {
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    if (loaded.project.extensions.length === 0)
      throw new UsageError(
        `No project.extensions to migrate in ${path.basename(configPath)}`,
      );

    const interactive = prompts.enabled && !yes;
    const result = await migrateProjectExtensions({
      configPath,
      configDir,
      config: loaded,
      nameFor: interactive
        ? (name, source) =>
            prompts.text({
              message: `Name for ${source}`,
              defaultValue: name,
            })
        : undefined,
    });
    for (const warning of result.warnings) reporter.warn(warning);
    if (result.diff) reporter.text(result.diff);
    reporter.success(`Backed up ${path.basename(configPath)} -> ${result.backup}`);
    reporter.success(`Migrated ${result.migrated.length} extension(s) to vendor:`);
    for (const entry of result.migrated)
      reporter.item(entry.name, entry.file, { width: 24 });

    return {
      backup: result.backup,
      migrated: result.migrated.map(({ name, file }) => ({ name, file })),
      warnings: result.warnings,
    };
  },
};
