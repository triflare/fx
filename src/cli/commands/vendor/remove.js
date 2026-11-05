import path from "node:path";
import { removeVendoredExtension } from "../../../vendor.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorRemoveCommand = {
  name: "remove",
  summary: "Remove a vendored extension",
  description:
    "Remove an extension from the project config, fx.lock, and the vendor directory.",
  arguments: ["<name>"],
  examples: ["fx vendor remove signals"],
  async run({ args, cwd, reporter, prompts, yes, product }) {
    const name = args[0];
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);

    await prompts.confirmDestructive({
      message: `Remove vendored extension ${JSON.stringify(name)}?`,
      yes,
    });

    const result = removeVendoredExtension({
      configPath,
      configDir,
      config: loaded,
      name,
    });
    reporter.success(
      `Removed ${name} from ${path.basename(configPath)}, fx.lock and ${result.file}`,
    );
    return { name, file: result.file };
  },
};
