import path from "node:path";
import { updateVendor } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorUpdateCommand = {
  name: "update",
  summary: "Update vendored extensions and show diffs",
  description: `Re-fetch upstream sources, update the vendored copies, and show a
diff for each change. Use --dry-run to preview without writing.`,
  arguments: ["[name]"],
  options: [
    { flags: "--dry-run", description: "Show diffs without writing files" },
  ],
  examples: ["fx vendor update", "fx vendor update signals --dry-run"],
  async run({ args, options, cwd, reporter, product }) {
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    if (loaded.vendor.length === 0)
      throw new UsageError(`No vendor entries in ${path.basename(configPath)}`);

    const result = await updateVendor({
      configPath,
      configDir,
      config: loaded,
      name: args[0],
      write: !options.dryRun,
    });
    for (const entry of result.entries) {
      if (!entry.changed) {
        reporter.info(`${entry.name} is up to date`);
        continue;
      }
      reporter.text(entry.diff);
    }
    if (options.dryRun && result.changed > 0)
      reporter.info(`Dry run: ${result.changed} extension(s) would change`);
    else if (result.changed > 0)
      reporter.success(`Updated ${result.changed} extension(s)`);
    else reporter.success("Everything is up to date");

    return {
      dryRun: Boolean(options.dryRun),
      changed: result.changed,
      entries: result.entries.map(({ name, changed }) => ({ name, changed })),
    };
  },
};
