import path from "node:path";
import { findConfigPath } from "../../config.js";
import {
  disableFeature,
  enableFeature,
  featureEnabled,
  featureNames,
  getFeature,
  migrateFeatureConfig,
  updateFeature,
} from "../../features.js";
import { loadVendorConfig, requireConfigPath } from "./vendor/helpers.js";
import { UsageError } from "../errors.js";

const ACTIONS = ["enable", "disable", "update"];

function featureSetting(feature) {
  return `fx.features.${feature.name}`;
}

function describeStatus(feature, enabled) {
  if (enabled)
    return feature.command
      ? `Run "fx ${feature.command}" to use this feature.`
      : `This feature is active in builds.`;
  return `Run "fx feature ${feature.name} enable" to enable it.`;
}

export const featureCommand = {
  name: "feature",
  group: "Core Commands:",
  summary: "List, install, update or remove an optional feature",
  description: `Every optional feature is registered once and switched under
the "fx.features" key in fx.yml. "enable" turns a feature on (copying its
extension into the project when it has one); "update" replaces that copy
with the one bundled in this Fx version; and "disable" turns it off.
"fx feature migrate" moves older fx.tests, fx.run, fx.partialSprites, and
top-level features: settings under fx.features.`,
  arguments: ["[name]", "[action]"],
  options: [
    {
      flags: "--force",
      description: "Replace an installed copy that was edited (enable)",
    },
    { flags: "--dry-run", description: "Preview update or migration" },
  ],
  examples: [
    "fx feature list",
    "fx feature tests enable",
    "fx feature partialSprites enable",
    "fx feature temporaryvariables update --dry-run",
    "fx feature migrate",
  ],
  async run({ args, options, cwd, reporter, prompts, yes, product }) {
    const [name, action] = args;

    if (name == null || name === "list") {
      const configPath = findConfigPath(cwd);
      const rows = featureNames().map((featureName) => {
        const feature = getFeature(featureName);
        const enabled = featureEnabled({ configPath, name: featureName });
        reporter.item(featureName, enabled ? "enabled" : "disabled", {
          width: 20,
          suffix: feature.title,
        });
        return {
          name: featureName,
          title: feature.title,
          enabled,
          setting: featureSetting(feature),
        };
      });
      return { features: rows };
    }

    if (name === "migrate") {
      if (action != null)
        throw new UsageError(`"fx feature migrate" does not take an action.`, {
          hint: `use "fx feature <name> <action>" for a single feature`,
        });
      const configPath = requireConfigPath(cwd, product);
      const result = migrateFeatureConfig({
        configPath,
        dryRun: Boolean(options.dryRun),
      });
      if (!result.changed) {
        reporter.info("No legacy feature settings to migrate");
        return { action: "migrate", migrated: [], changed: false };
      }
      reporter.text(result.diff);
      if (options.dryRun) reporter.info("Dry run: fx.yml would be migrated");
      else
        reporter.success(
          `Migrated ${result.migrated.length} feature setting(s); backup: ${path.basename(
            result.backup,
          )}`,
        );
      return {
        action: "migrate",
        migrated: result.migrated,
        changed: true,
        dryRun: Boolean(options.dryRun),
      };
    }

    const configPath = requireConfigPath(cwd, product);
    const configDir = path.dirname(configPath);
    const feature = getFeature(name);

    if (action == null) {
      const enabled = featureEnabled({ configPath, name: feature.name });
      reporter.detail("Feature", feature.title);
      reporter.detail("Status", enabled ? "enabled" : "disabled");
      reporter.detail("Setting", featureSetting(feature));
      reporter.info(describeStatus(feature, enabled));
      return {
        feature: feature.name,
        action: "status",
        enabled,
      };
    }

    if (!ACTIONS.includes(action))
      throw new UsageError(
        `Unknown feature action ${JSON.stringify(action)} for ${JSON.stringify(name)}.`,
        { hint: `use one of: ${ACTIONS.join(", ")}` },
      );

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
        reporter.success(
          result.file
            ? `${result.feature.title} enabled (${result.file})`
            : `${result.feature.title} enabled`,
        );
      else reporter.info(`${result.feature.title} is already enabled`);
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
      if (feature.core) {
        const result = disableFeature({ configPath, configDir, name });
        if (!result.changed) {
          reporter.info(`${result.feature.title} is already disabled`);
          return {
            feature: result.name,
            action,
            changed: false,
            warning: null,
          };
        }
        reporter.success(`Disabled ${result.feature.title}`);
        return {
          feature: result.name,
          action,
          changed: true,
          warning: result.warning,
        };
      }
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
