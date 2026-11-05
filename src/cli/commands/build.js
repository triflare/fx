import fs from "node:fs";
import path from "node:path";
import { build } from "../../build.js";
import { outputDirectory, sourceExtension } from "../../brand.js";
import { slugify } from "../../package.js";
import { loadProjectState } from "../context.js";
import { formatDuration } from "../format.js";

const EXTENSION = sourceExtension();

export const buildCommand = {
  name: "build",
  aliases: ["b"],
  group: "Core Commands:",
  summary: "Compile sources into a .pmp",
  description: `Compile a source file, or every ${EXTENSION} file in a directory
(defaults to the working directory), into one .pmp archive.`,
  arguments: [`[input${EXTENSION}|dir]`],
  options: [{ flags: "-o, --output <file>", description: "Output .pmp path" }],
  examples: [
    "fx build",
    "fx build src/main.tfx -o build/game.pmp",
    "fx build examples/player --no-config",
  ],
  async run({ args, options, cwd, reporter, prompts }) {
    const started = performance.now();
    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      prompts,
    });
    const { target, loaded, catalog, extensionUrls } = state;

    const result = build({
      ...target,
      projectConfig: loaded.project,
      fxConfig: loaded.fx,
      catalog,
      extensionUrls,
      useConfigFile: false,
    });
    for (const warning of result.warnings) reporter.warn(warning);

    const explicit = options.output;
    let output;
    if (explicit) {
      output = path.resolve(cwd, explicit);
    } else if (target.file) {
      output = target.file.toLowerCase().endsWith(EXTENSION.toLowerCase())
        ? `${target.file.slice(0, -EXTENSION.length)}.pmp`
        : `${target.file}.pmp`;
    } else {
      output = path.join(
        target.dir,
        outputDirectory(),
        `${slugify(result.config.name || path.basename(target.dir))}.pmp`,
      );
    }
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, result.sb3);

    const blockCount = result.project.targets.reduce(
      (sum, item) => sum + Object.keys(item.blocks).length,
      0,
    );
    const durationMs = Math.round(performance.now() - started);

    reporter.success(`Built ${output}`);
    reporter.text("");
    reporter.detail("Sources", `${result.files.length} file(s)`);
    reporter.detail("Targets", result.project.targets.length);
    reporter.detail("Blocks", blockCount);
    reporter.detail("Assets", result.assets.size);
    reporter.detail(
      "Extensions",
      result.project.extensions.join(", ") || "(none)",
    );
    reporter.detail("Time", formatDuration(durationMs));
    if (state.unsandboxed.length)
      reporter.detail(
        "Unsandboxed",
        `${state.unsandboxed.join(", ")} (must be allowed in the editor)`,
      );

    return {
      output,
      sources: result.files,
      targets: result.project.targets.length,
      blocks: blockCount,
      assets: result.assets.size,
      extensions: result.project.extensions,
      unsandboxed: state.unsandboxed,
      durationMs,
    };
  },
};
