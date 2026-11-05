import fs from "node:fs";
import path from "node:path";
import { findConfigPath } from "../../../config.js";
import { sourceExtension } from "../../../brand.js";
import { slugify } from "../../../package.js";
import { parse } from "../../../parser.js";
import { readSprite, spriteSource } from "../../../sprite.js";
import { CliError } from "../../errors.js";
import {
  readInputBytes,
  spriteNames,
  spriteRoot,
  spriteSourceDir,
} from "./helpers.js";

export const spriteAddCommand = {
  name: "add",
  summary: "Import a .sprite3/.pms sprite as source",
  description: `Import a sprite archive, write its assets, and generate a .tfx
source file.`,
  arguments: ["<source>"],
  options: [
    { flags: "--name <name>", description: "Override the sprite name" },
    { flags: "--force", description: "Overwrite an existing source file" },
  ],
  examples: [
    "fx sprite add robot.sprite3",
    "fx sprite add https://example.com/cat.pms --name Cat",
  ],
  async run({ args, options, cwd, reporter, product }) {
    const source = args[0];
    const configPath = findConfigPath(cwd);
    const rootDir = spriteRoot(cwd, configPath);

    const { sprite, assets } = readSprite(await readInputBytes(source, cwd));
    const name = typeof options.name === "string" ? options.name : sprite.name;
    if (!name)
      throw new CliError("sprite add could not read a sprite name", {
        code: "SPRITE_NAME_MISSING",
        hint: "pass --name <name>",
      });
    sprite.name = name;

    const existing = spriteNames(rootDir).find((entry) => entry.name === name);
    if (existing)
      throw new CliError(
        `A sprite named ${JSON.stringify(name)} already exists in ${existing.file}`,
        {
          code: "SPRITE_EXISTS",
          hint: "remove it first, or choose another name with --name",
        },
      );

    const sourceDir = spriteSourceDir(rootDir, product);
    const file = path.join(
      sourceDir,
      `${slugify(name)}${sourceExtension(product)}`,
    );
    if (fs.existsSync(file) && !options.force)
      throw new CliError(`${file} already exists`, {
        code: "SPRITE_FILE_EXISTS",
        hint: "pass --force to overwrite",
      });

    const assetsDir = path.join(rootDir, "assets");
    const relative = path.relative(sourceDir, assetsDir).replace(/\\/g, "/");
    const text = spriteSource(sprite, {
      assetPrefix: relative ? `${relative}/` : "",
    });
    parse(text, file);

    fs.mkdirSync(assetsDir, { recursive: true });
    for (const [assetName, data] of assets)
      fs.writeFileSync(path.join(assetsDir, assetName), data);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(file, text);

    reporter.success(`Added sprite ${name} -> ${path.relative(rootDir, file)}`);
    return {
      name,
      file,
      assets: [...assets.keys()],
    };
  },
};
