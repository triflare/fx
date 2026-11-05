import fs from "node:fs";
import path from "node:path";
import { build } from "../../build.js";
import { normalizePackageTarget } from "../../config.js";
import { packageProject } from "../../packager.js";
import {
  extractArchive,
  packageOutputPath,
  resolvePackageConfig,
} from "../../package.js";
import { loadProjectState } from "../context.js";
import { UsageError } from "../errors.js";
import { formatBytes, formatDuration } from "../format.js";

function isArchive(file) {
  return path.extname(file).toLowerCase() === ".pmp";
}

export const packageCommand = {
  name: "package",
  aliases: ["p", "pack"],
  group: "Core Commands:",
  summary: "Package into HTML, ZIP, or a desktop build",
  description: `Package a source, project archive, or directory into HTML, a ZIP
archive, or a desktop build (Windows/macOS/Linux use Electron).`,
  arguments: ["[input.tfx|input.pmp|dir]"],
  options: [
    { flags: "-o, --output <file>", description: "Output file or directory" },
    { flags: "--target <target>", description: "Packaging target" },
    { flags: "--extract", description: "Extract a packaged archive" },
  ],
  examples: [
    "fx package",
    "fx package --target html",
    "fx package build/game.pmp --target windows --extract",
  ],
  async run({ args, options, cwd, reporter, prompts }) {
    const started = performance.now();
    const input = args[0];
    const archiveInput = input ? isArchive(path.resolve(cwd, input)) : false;
    const state = await loadProjectState({
      input,
      cwd,
      options,
      reporter,
      prompts,
      includeExtensions: !archiveInput,
    });
    const { target, loaded, searchDir } = state;

    let sb3;
    let projectName;
    if (target.file && isArchive(target.file)) {
      sb3 = fs.readFileSync(target.file);
      projectName = path.basename(target.file, path.extname(target.file));
    } else {
      const result = build({
        ...target,
        projectConfig: loaded.project,
        fxConfig: loaded.fx,
        catalog: state.catalog,
        extensionUrls: state.extensionUrls,
        useConfigFile: false,
      });
      for (const warning of result.warnings) reporter.warn(warning);
      sb3 = result.sb3;
      projectName = result.config.name;
    }

    const baseDir = loaded.path ? path.dirname(loaded.path) : searchDir;
    const pkg = resolvePackageConfig(loaded.package, {
      baseDir,
      projectName,
    });

    if (typeof options.target === "string")
      pkg.target = normalizePackageTarget(options.target);
    if (typeof options.output === "string")
      pkg.output = path.resolve(cwd, options.output);
    const extract = Boolean(options.extract) || pkg.extract;
    if (extract && pkg.target === "html")
      throw new UsageError("--extract only applies to zip and desktop targets");

    const output = packageOutputPath({
      target: pkg.target,
      output: pkg.output,
      name: pkg.name || projectName,
      dir: baseDir,
    });

    const spinner = prompts.spinner();
    spinner.start("Packaging project...");
    let result;
    try {
      result = await packageProject({
        sb3,
        projectName,
        packageConfig: pkg,
        onProgress: (message) => spinner.message(String(message)),
      });
    } finally {
      spinner.stop();
    }

    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, result.data);
    const durationMs = Math.round(performance.now() - started);

    reporter.success(`Packaged ${output}`);
    reporter.text("");
    reporter.detail("Target", result.target);
    reporter.detail("Type", result.type);
    reporter.detail("Size", formatBytes(result.data.length));
    reporter.detail("Time", formatDuration(durationMs));

    let extracted = null;
    if (extract) {
      const extension = path.extname(output);
      const extractDir = path.join(
        path.dirname(output),
        path.basename(output, extension),
      );
      const files = await extractArchive(result.data, extractDir);
      extracted = { directory: extractDir, files };
      reporter.success(`Extracted ${files.length} file(s) to ${extractDir}`);
    }

    return {
      output,
      target: result.target,
      type: result.type,
      size: result.data.length,
      extracted,
      durationMs,
    };
  },
};
