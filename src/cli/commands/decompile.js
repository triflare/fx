import fs from "node:fs";
import path from "node:path";
import { decompileProject } from "../../decompiler.js";
import { unzipSync } from "../../sb3.js";
import { addProjectExtension } from "../../config.js";
import { configFilename, configFilenames } from "../../brand.js";
import { loadExtensions, readExtensionDataUri } from "../../extensions.js";
import { truncate } from "../format.js";
import { UsageError } from "../errors.js";

/**
 * Recover the extensions a decompiled project references.
 *
 * An archive only remembers extension sources through `project.extensionURLs`:
 * Fx stores local extension files there as data URIs, and PenguinMod projects
 * keep plain URLs. Data URIs are written next to the output and referenced
 * from the config file; URLs stay URLs.
 */
function restoreExtensions(project, outDir, { fetchRemote = false } = {}) {
  const result = { entries: [], loadEntries: [], files: [], warnings: [] };
  const urls = project && project.extensionURLs;
  if (!urls || typeof urls !== "object") return result;

  let extensionDir = null;
  let extensionDirProblem = null;
  const resolveExtensionDir = () => {
    if (extensionDir || extensionDirProblem) return;
    const dir = path.join(outDir, "extensions");
    const existing = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (existing && !existing.isDirectory()) {
      extensionDirProblem = existing.isSymbolicLink()
        ? `"${dir}" is a symlink, so the extension would land outside the output directory`
        : `"${dir}" is not a directory`;
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const expected = path.join(fs.realpathSync(outDir), "extensions");
    const actual = fs.realpathSync(dir);
    if (actual !== expected) {
      extensionDirProblem = `"${dir}" resolves to ${actual}, outside the output directory`;
      return;
    }
    extensionDir = dir;
  };

  const used = new Set();
  for (const [id, value] of Object.entries(urls)) {
    const uri = typeof value === "string" ? value.trim() : "";
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) {
      result.entries.push(uri);
      if (fetchRemote) result.loadEntries.push(uri);
      else
        result.warnings.push(
          `extension ${id} points at a remote URL (${truncate(uri, 48)}); ` +
            "not fetching it, so its blocks stay unsupported — pass " +
            "--fetch-extensions to load it",
        );
      continue;
    }
    if (!/^data:/i.test(uri)) {
      result.warnings.push(
        `extension ${id} uses an unsupported URL (${truncate(uri, 48)}); ` +
          `add it to ${configFilename()} by hand`,
      );
      continue;
    }
    const source = readExtensionDataUri(uri);
    if (source == null) {
      result.warnings.push(
        `extension ${id} has an unreadable data URI; ` +
          `add it to ${configFilename()} by hand`,
      );
      continue;
    }
    const keepEmbedded = (warning) => {
      result.loadEntries.push(uri);
      if (outDir) result.entries.push(uri);
      result.warnings.push(warning);
    };
    if (!outDir) {
      keepEmbedded(
        `extension ${id} is embedded in the archive; pass -o to write it out ` +
          `and reference it from ${configFilename()}`,
      );
      continue;
    }
    resolveExtensionDir();
    if (extensionDirProblem) {
      keepEmbedded(
        `extension ${id} was not written: ${extensionDirProblem}; its blocks ` +
          "still decompile and the config keeps its source, but the extension " +
          "file is missing from the output",
      );
      continue;
    }
    const base = extensionFileStem(id);
    let stem = base;
    for (let suffix = 2; used.has(stem); suffix += 1)
      stem = `${base}-${suffix}`;
    used.add(stem);
    const file = path.join(extensionDir, `${stem}.js`);
    const relative = `extensions/${stem}.js`;
    const existing = fs.lstatSync(file, { throwIfNoEntry: false });
    if (existing) {
      if (existing.isFile() && fs.readFileSync(file, "utf8") === source) {
        result.files.push(relative);
        result.entries.push(relative);
        result.loadEntries.push(file);
      } else {
        keepEmbedded(
          `extension ${id} not written to ${relative}: ` +
            (existing.isSymbolicLink()
              ? "the path is a symlink"
              : "a different file already exists") +
            "; the config keeps the archive's copy, so delete or rename it to " +
            "write the extension file",
        );
      }
      continue;
    }
    try {
      fs.writeFileSync(file, source, { flag: "wx" });
    } catch (err) {
      keepEmbedded(
        `extension ${id} not written to ${relative}: ` +
          (err.code === "EEXIST"
            ? "the path appeared while decompiling"
            : `${err.code || err.message}`) +
          "; the config keeps the archive's copy, so delete or rename it to " +
          "write the extension file",
      );
      continue;
    }
    result.files.push(relative);
    result.entries.push(relative);
    result.loadEntries.push(file);
  }
  return result;
}

/** Sanitize an extension id into a portable file name stem. */
function extensionFileStem(id) {
  return (
    String(id)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "extension"
  );
}

function writeRestoredConfig(outDir, entries) {
  if (entries.length === 0) return null;
  const existing = configFilenames()
    .map((name) => path.join(outDir, name))
    .find((file) => fs.existsSync(file));
  if (existing) {
    let added = 0;
    for (const entry of entries)
      if (addProjectExtension(existing, entry).added) added += 1;
    return { file: existing, added };
  }
  const file = path.join(outDir, configFilenames()[0]);
  const lines = ["project:", "  extensions:"];
  for (const entry of entries) lines.push(`    - ${JSON.stringify(entry)}`);
  lines.push("");
  fs.writeFileSync(file, lines.join("\n"));
  return { file, added: entries.length };
}

export const decompileCommand = {
  name: "decompile",
  aliases: ["d"],
  group: "Core Commands:",
  summary: "Convert a .pmp back into source",
  description: `Convert a .pmp archive back into Triflare Fx source, restoring
extensions into the project config.`,
  arguments: ["<input.pmp>"],
  options: [
    { flags: "-o, --output <file>", description: "Output source file" },
    {
      flags: "--assets <dir>",
      description: "Extract project assets into <dir>",
    },
    {
      flags: "--fetch-extensions",
      description: "Load remote extensions while decompiling",
    },
  ],
  examples: [
    "fx decompile build/game.pmp -o src/main.tfx --assets assets",
    "fx decompile build/game.pmp --fetch-extensions",
  ],
  async run({ args, options, cwd, reporter }) {
    const input = path.resolve(cwd, args[0]);
    const data = fs.readFileSync(input);
    const files = unzipSync(data);
    const projectJson = files.get("project.json");
    if (!projectJson)
      throw new UsageError("Not a Scratch project: missing project.json");
    const project = JSON.parse(projectJson.toString("utf8"));

    const output = options.output ? path.resolve(cwd, options.output) : null;
    const outDir = output ? path.dirname(output) : null;
    const restored = restoreExtensions(project, outDir, {
      fetchRemote: Boolean(options.fetchExtensions),
    });
    for (const warning of restored.warnings) reporter.warn(warning);

    let catalog = {};
    if (restored.loadEntries.length > 0) {
      const loaded = await loadExtensions(restored.loadEntries, {
        baseDir: outDir || cwd,
      });
      catalog = loaded.catalog;
      for (const warning of loaded.warnings) reporter.warn(warning);
    }

    const assetDir = options.assets ? path.resolve(cwd, options.assets) : null;
    let assetPrefix = "";
    if (assetDir) {
      fs.mkdirSync(assetDir, { recursive: true });
      const resolvedAssetDir = fs.realpathSync(assetDir);
      for (const [name, buffer] of files) {
        if (!/^[0-9a-f]{32}\.[a-z0-9]+(?![\s\S])/i.test(name)) continue;
        const destination = path.resolve(resolvedAssetDir, name);
        if (path.dirname(destination) !== resolvedAssetDir) continue;
        if (
          fs.lstatSync(destination, { throwIfNoEntry: false })?.isSymbolicLink()
        )
          continue;
        fs.writeFileSync(destination, buffer);
      }
      const rel = path.relative(outDir || cwd, assetDir).replace(/\\/g, "/");
      assetPrefix = rel ? `${rel}/` : "";
    }

    const source = decompileProject(project, { assetPrefix, catalog });

    if (!output) {
      reporter.text(source.endsWith("\n") ? source.slice(0, -1) : source);
      return {
        source,
        output: null,
        extensions: restored.files,
        warnings: restored.warnings,
      };
    }

    fs.writeFileSync(output, source);
    const config = writeRestoredConfig(outDir, restored.entries);
    reporter.success(`Decompiled ${args[0]} -> ${options.output}`);
    if (config)
      reporter.success(
        `Restored ${config.added} extension(s) -> ${
          path.relative(cwd, config.file) || config.file
        }`,
      );

    return {
      output,
      assets: assetDir ? path.resolve(assetDir) : null,
      extensions: restored.files,
      config: config ? { file: config.file, added: config.added } : null,
    };
  },
};
