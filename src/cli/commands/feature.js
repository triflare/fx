import path from "node:path";
import {
  disableFeature,
  enableFeature,
  updateFeature,
} from "../../features.js";
import { loadVendorConfig, requireConfigPath } from "./vendor/helpers.js";
import { UsageError } from "../errors.js";

const ACTIONS = ["enable", "disable", "update"];

export const featureCommand = {
  name: "feature",
  group: "Core Commands:",
  summary: "Install, update or remove a built-in language feature",
  description: `Features are extension-backed language additions. "enable" copies the\nfeature's file into the project and records it under "features:" in fx.yml;\n"update" replaces that copy with the one bundled in this Fx version; and\n"disable" removes both. The file is committed, so Fx upgrades never change it.`,
  arguments: ["<name>", "<action>"],
  options: [
    {
      flags: "--force",
      description: "Replace an installed copy that was edited (enable)",
    },
    { flags: "--dry-run", description: "Preview update without writing files" },
  ],
  examples: [
    "fx feature temporaryvariables enable",
    "fx feature temporaryvariables update --dry-run",
    "fx feature temporaryvariables disable",
  ],
  async run({ args, options, cwd, reporter, prompts, yes, product }) {
    const [name, action] = args;
    if (!ACTIONS.includes(action))
      throw new UsageError(
        `Unknown feature action ${JSON.stringify(action)} for ${JSON.stringify(name)}.`,
        { hint: `use one of: ${ACTIONS.join(", ")}` },
      );

    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    if (action === "enable") {
      const loaded = loadVendorConfig(configPath);
      const result = enableFeature({
        configPath,
        configDir,
        name,
        vendorDir: loaded.vendorDir,
        force: Boolean(options.force),
      });
      if (result.changed)
        reporter.success(`${result.feature.title} enabled (${result.file})`);
      else reporter.info(`${result.feature.title} is already installed`);
      if (result.configChanged)
        reporter.info(`Recorded the feature in ${path.basename(configPath)}`);
      return {
        feature: result.name,
        action,
        file: result.file,
        changed: result.changed,
      };
    }

    if (action === "disable") {
      await prompts.confirmDestructive({
        message: `Disable ${name} and delete its installed file?`,
        yes,
      });
      const result = disableFeature({ configPath, configDir, name });
      if (result.fileRemoved)
        reporter.success(
          `Disabled ${result.feature.title} (${result.file}) and deleted its copy`,
        );
      else
        reporter.success(`Disabled ${result.feature.title} (${result.file})`);
      if (result.filePreserved)
        reporter.info(
          `Kept ${result.file}: it is not the copy Fx installs, so it may be user-owned`,
        );
      return {
        feature: result.name,
        action,
        file: result.file,
        fileRemoved: result.fileRemoved,
        filePreserved: result.filePreserved,
      };
    }

    const result = updateFeature({
      configPath,
      configDir,
      name,
      dryRun: Boolean(options.dryRun),
    });
    if (!result.changed) {
      reporter.info(`${result.feature.title} is already up to date`);
      return {
        feature: result.name,
        action,
        file: result.file,
        changed: false,
      };
    }
    reporter.text(result.diff);
    if (result.dryRun)
      reporter.info(`Dry run: ${result.file} would be replaced`);
    else reporter.success(`Updated ${result.feature.title} (${result.file})`);
    return {
      feature: result.name,
      action,
      file: result.file,
      changed: true,
      dryRun: result.dryRun,
    };
  },
};
