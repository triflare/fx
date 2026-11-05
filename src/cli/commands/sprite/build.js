import fs from "node:fs";
import path from "node:path";
import { build } from "../../../build.js";
import { outputDirectory } from "../../../brand.js";
import { slugify } from "../../../package.js";
import { spriteArchive } from "../../../sprite.js";
import { loadProjectState } from "../../context.js";
import { CliError } from "../../errors.js";

export const spriteBuildCommand = {
  name: "build",
  summary: "Compile one sprite into a .pms archive",
  description:
    "Build a single sprite from the current project into a .pms file.",
  arguments: ["<name>"],
  options: [{ flags: "-o, --output <file>", description: "Output .pms path" }],
  examples: ["fx sprite build Cat", "fx sprite build Cat -o cat.pms"],
  async run({ args, options, cwd, reporter, prompts }) {
    const name = args[0];
    const state = await loadProjectState({
      input: undefined,
      cwd,
      options,
      reporter,
      prompts,
    });
    const result = build({
      ...state.target,
      projectConfig: state.loaded.project,
      fxConfig: state.loaded.fx,
      catalog: state.catalog,
      extensionUrls: state.extensionUrls,
      useConfigFile: false,
    });

    const sprite = result.project.targets.find(
      (target) => !target.isStage && target.name === name,
    );
    if (!sprite) {
      const available = result.project.targets
        .filter((target) => !target.isStage)
        .map((target) => target.name);
      throw new CliError(
        `No sprite named ${JSON.stringify(name)}. ` +
          (available.length
            ? `Available: ${available.join(", ")}`
            : "The project has no sprites."),
        { code: "SPRITE_NOT_FOUND" },
      );
    }

    const output =
      options.output !== undefined
        ? path.resolve(cwd, options.output)
        : path.join(cwd, outputDirectory(), `${slugify(name)}.pms`);
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, spriteArchive(sprite, result.assets));

    reporter.success(`Built sprite ${name} -> ${output}`);
    return { name, output };
  },
};
