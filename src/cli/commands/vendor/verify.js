import path from "node:path";
import { LOCK_FILENAME, verifyVendor } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import { outcome } from "../../define-command.js";
import { loadVendorConfig, requireConfigPath } from "./helpers.js";

export const vendorVerifyCommand = {
  name: "verify",
  summary: "Check vendored files against fx.lock offline",
  description:
    "Verify every vendored extension without making network requests.",
  examples: ["fx vendor verify"],
  run({ cwd, reporter, product }) {
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    if (loaded.vendor.length === 0)
      throw new UsageError(`No vendor entries in ${path.basename(configPath)}`);

    const result = verifyVendor({ configDir, config: loaded });
    for (const warning of result.warnings) reporter.warn(warning);
    for (const entry of result.entries)
      if (entry.status === "ok")
        reporter.item(entry.name, entry.file, { width: 24 });

    if (!result.ok) {
      for (const problem of result.problems) reporter.error(problem);
      return outcome({
        exitCode: 1,
        data: { entries: result.entries, problems: result.problems },
        error: {
          code: "VENDOR_VERIFY_FAILED",
          message: `Vendor verification failed for ${result.problems.length} extension(s)`,
          details: { problems: result.problems },
        },
      });
    }

    reporter.success(
      `Verified ${result.entries.length} extension(s) against ${LOCK_FILENAME}`,
    );
    return { entries: result.entries };
  },
};
