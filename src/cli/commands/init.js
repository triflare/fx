import fs from "node:fs";
import path from "node:path";
import { normalizePackageTarget } from "../../config.js";
import { UsageError } from "../errors.js";
import {
  initFiles,
  STAGE_SIZES,
  TARGETS,
  TEMPLATES,
} from "../templates/index.js";

const TEMPLATE_VALUES = new Set(TEMPLATES.map((entry) => entry.value));
const TARGET_VALUES = new Set(TARGETS.map((entry) => entry.value));

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value).trim());
  if (!match)
    throw new UsageError(
      `--size must look like 480x360, received ${JSON.stringify(value)}`,
    );
  return { width: Number(match[1]), height: Number(match[2]) };
}

function sizeValue(width, height) {
  return `${width}x${height}`;
}

export const initCommand = {
  name: "init",
  aliases: ["i"],
  group: "Core Commands:",
  summary: "Create a new project",
  description: `Scaffold a project config, a source file, and optional starter
assets. On a terminal this opens a short wizard; use --yes for defaults.`,
  arguments: ["[dir]"],
  options: [
    { flags: "--name <name>", description: "Project name" },
    {
      flags: "--template <template>",
      description: "Template: cat, empty, or blank",
    },
    {
      flags: "--target <target>",
      description: "Package target: none, html, or zip",
    },
    {
      flags: "--size <WxH>",
      description: "Stage size (default 480x360)",
    },
    { flags: "--force", description: "Overwrite existing files" },
  ],
  examples: [
    "fx init",
    "fx init examples/demo --yes",
    "fx init --template blank --target zip",
  ],
  async run({ args, options, cwd, reporter, prompts, product, yes }) {
    const directory = path.resolve(cwd, args[0] || ".");
    const defaultName = `My ${product.name} Project`;
    const interactive = prompts.enabled && !yes;

    if (interactive) prompts.intro("Create a new project");

    const name =
      options.name ??
      (interactive
        ? await prompts.text({
            message: "Project name",
            defaultValue: defaultName,
          })
        : defaultName);

    let template = options.template ?? "cat";
    if (!TEMPLATE_VALUES.has(template))
      throw new UsageError(
        `--template must be one of: ${[...TEMPLATE_VALUES].join(", ")}`,
      );
    if (interactive && options.template === undefined)
      template = await prompts.select({
        message: "Template",
        options: TEMPLATES,
        initialValue: template,
      });

    let size = options.size ?? "480x360";
    if (interactive && options.size === undefined)
      size = await prompts.select({
        message: "Stage size",
        options: STAGE_SIZES,
        initialValue: "480x360",
      });
    const { width, height } = parseSize(size);

    let target = options.target ?? "html";
    if (!TARGET_VALUES.has(target)) {
      try {
        target = normalizePackageTarget(target);
      } catch {
        throw new UsageError(
          `--target must be one of: ${[...TARGET_VALUES].join(", ")}`,
        );
      }
    }
    if (interactive && options.target === undefined)
      target = await prompts.select({
        message: "Package target",
        options: TARGETS,
        initialValue: target,
      });

    const files = initFiles({
      product,
      name,
      template,
      width,
      height,
      target,
    });
    const conflicts = Object.keys(files).filter((relative) =>
      fs.existsSync(path.join(directory, relative)),
    );

    let force = Boolean(options.force);
    if (conflicts.length > 0 && !force) {
      if (interactive) {
        const overwrite = await prompts.confirm({
          message: `Overwrite ${conflicts.length} existing file(s)?`,
          initialValue: false,
        });
        force = Boolean(overwrite);
      }
      if (!force)
        reporter.warn(
          `Skipping ${conflicts.length} existing file(s); pass --force to overwrite`,
        );
    }

    const written = [];
    for (const relative of Object.keys(files).sort()) {
      const destination = path.join(directory, relative);
      if (fs.existsSync(destination) && !force) {
        written.push({ path: relative, status: "skipped" });
        continue;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, files[relative]);
      written.push({ path: relative, status: "written" });
      reporter.bullet(relative);
    }

    const count = written.filter((entry) => entry.status === "written").length;
    reporter.success(
      `Created ${count} file(s) in ${path.relative(cwd, directory) || "."}`,
    );
    if (interactive)
      prompts.outro(
        `Run "${product.command} build" or "${product.command} dev" next.`,
      );

    return {
      directory,
      name,
      template,
      target,
      size: sizeValue(width, height),
      files: written,
    };
  },
};
