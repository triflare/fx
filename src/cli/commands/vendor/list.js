import path from "node:path";
import { readLock } from "../../../vendor.js";
import {
  loadVendorConfig,
  requireConfigPath,
  vendorEntriesWithLock,
} from "./helpers.js";

export const vendorListCommand = {
  name: "list",
  summary: "List vendored extensions",
  description: "List every extension declared in the vendor config.",
  examples: ["fx vendor list", "fx vendor list --json"],
  run({ cwd, reporter, product }) {
    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const loaded = loadVendorConfig(configPath);
    const lock = readLock(configDir);
    const entries = vendorEntriesWithLock(loaded, lock, configDir);

    reporter.heading(
      `${path.basename(configPath)}: ${entries.length} vendored extension(s) in ${
        loaded.vendorDir || "extensions"
      }/`,
    );
    for (const entry of entries) {
      const flags = [
        entry.remote ? "remote" : entry.local ? "local" : "embedded",
        entry.volatile ? "volatile" : null,
        entry.unsandboxed ? "unsandboxed" : null,
      ]
        .filter(Boolean)
        .join(", ");
      reporter.item(entry.name, entry.file, {
        width: 24,
        suffix: flags ? `[${flags}]` : "",
      });
    }

    return {
      vendorDir: loaded.vendorDir || "extensions",
      extensions: entries,
    };
  },
};
