import path from "node:path";
import { outdatedVendor } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import { outcome } from "../../define-command.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorOutdatedCommand = {
  name: "outdated",
  summary: "Compare upstream sources with fx.lock",
  description: "Check whether any vendored extension changed upstream.",
  examples: ["fx vendor outdated"],
  async run({ cwd, reporter, product }) {
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    if (loaded.vendor.length === 0)
      throw new UsageError(`No vendor entries in ${path.basename(configPath)}`);

    const results = await outdatedVendor({ configDir, config: loaded });
    let outdated = 0;
    let errors = 0;
    for (const result of results) {
      if (result.status === "outdated") outdated += 1;
      if (result.status === "error") errors += 1;
      const label =
        result.status === "outdated"
          ? "outdated"
          : result.status === "error"
            ? "error"
            : "up to date";
      const tone =
        result.status === "outdated"
          ? "warning"
          : result.status === "error"
            ? "danger"
            : "success";
      reporter.item(result.name, label, { width: 24, tone });
      if (result.error) reporter.warn(result.error);
    }
    if (outdated > 0)
      reporter.warn(
        `${outdated} extension(s) changed upstream; run "${product.command} vendor update"`,
      );
    else if (errors === 0) reporter.success("Everything is up to date");

    return outcome({
      data: results,
      exitCode: errors > 0 ? 1 : 0,
    });
  },
};
