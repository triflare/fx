import path from "node:path";
import { defaultVendorName, installVendorEntry } from "../../../vendor.js";
import { UsageError } from "../../errors.js";
import {
  loadVendorConfig,
  requireConfigPath,
  vendorConfigSource,
} from "./helpers.js";

/** Shared implementation for `vendor add` and legacy `vendor install <src>`. */
export async function addVendor({
  source,
  options,
  cwd,
  reporter,
  product,
}) {
  if (!source) throw new UsageError("vendor add requires a path or URL");
  const configPath = requireConfigPath(cwd, product);
  const configDir = path.dirname(configPath);
  const loaded = loadVendorConfig(configPath);

  if (typeof options.as === "string" && options.as.trim() === "")
    throw new UsageError("--as needs a non-empty name");
  const name =
    typeof options.as === "string" ? options.as : defaultVendorName(source);
  const configSource = vendorConfigSource(source, configDir, cwd);
  const existing = loaded.vendor.find((entry) => entry.name === name);
  if (existing && existing.source !== configSource && !options.force)
    throw new UsageError(
      `A vendored extension named ${JSON.stringify(name)} already exists.`,
      {
        hint: `run "${product.command} vendor update ${name}" or pass --force to replace it`,
      },
    );

  const rawEntry = loaded.raw?.vendor?.[name];
  const existingVolatile =
    rawEntry &&
    typeof rawEntry === "object" &&
    Object.hasOwn(rawEntry, "volatile")
      ? Boolean(rawEntry.volatile)
      : existing?.volatile
        ? true
        : undefined;
  const result = await installVendorEntry({
    configPath,
    configDir,
    name,
    source: configSource,
    vendorDir: path.resolve(configDir, loaded.vendorDir || "extensions"),
    unsandboxed: Boolean(options.unsandboxed) || Boolean(existing?.unsandboxed),
    volatile: existingVolatile,
  });

  reporter.success(
    `Vendored ${name} -> ${result.file} (${result.lockEntry.sha256.slice(0, 12)}…)`,
  );
  if (existing)
    reporter.info(`Updated ${name} in ${path.basename(configPath)}`);
  else reporter.success(`Added ${name} to ${path.basename(configPath)}`);

  return {
    name,
    source: configSource,
    file: result.file,
    sha256: result.lockEntry.sha256,
    replaced: Boolean(existing),
  };
}

export const vendorAddCommand = {
  name: "add",
  summary: "Vendor an extension by URL or path",
  description: `Copy an extension into the vendor directory, record its SHA-256 in
fx.lock, and add it to the project config.`,
  arguments: ["<source>"],
  options: [
    { flags: "--as <name>", description: "Name for the vendored extension" },
    {
      flags: "--unsandboxed",
      description: "Allow the extension to run unsandboxed",
    },
    { flags: "--force", description: "Replace an existing entry with the name" },
  ],
  examples: [
    "fx vendor add https://example.com/signals.js --as signals",
    "fx vendor add ./src/mything.js",
  ],
  run(context) {
    return addVendor({
      source: context.args[0],
      options: context.options,
      cwd: context.cwd,
      reporter: context.reporter,
      product: context.product,
    });
  },
};
