import path from "node:path";
import { LOCK_FILENAME, installVendor } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import { addVendor } from "./add.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorInstallCommand = {
  name: "install",
  summary: "Restore vendored extensions from fx.lock",
  description: `Fetch only the vendored files that are missing, verifying them
against fx.lock. Without a source, restores every configured entry.`,
  arguments: ["[source]"],
  options: [
    { flags: "--as <name>", description: "Name for the vendored extension" },
    {
      flags: "--unsandboxed",
      description: "Allow the extension to run unsandboxed",
    },
    { flags: "--force", description: "Replace an existing entry with the name" },
  ],
  examples: ["fx vendor install", "fx vendor add https://example.com/ext.js"],
  async run(context) {
    const { args, options, cwd, reporter, product } = context;
    const source = args[0];
    if (source) {
      reporter.warn(
        '"vendor install <source>" is deprecated; use "vendor add <source>".',
      );
      return addVendor({ source, options, cwd, reporter, product });
    }

    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    if (loaded.vendor.length === 0)
      throw new UsageError(
        `No vendor entries in ${path.basename(configPath)}.`,
        {
          hint: `add one with "${product.command} vendor add <url|path>"`,
        },
      );

    const result = await installVendor({
      configPath,
      configDir,
      config: loaded,
    });
    for (const warning of result.warnings) reporter.warn(warning);
    for (const entry of result.entries)
      reporter.success(`${entry.name}: ${entry.status} (${entry.file})`);
    reporter.success(
      `Installed ${result.entries.length} extension(s) from ${LOCK_FILENAME}`,
    );

    return {
      lock: LOCK_FILENAME,
      entries: result.entries.map(({ name, status, file }) => ({
        name,
        status,
        file,
      })),
    };
  },
};
