/**
 * Single-sprite archives (`.pms`) and imports (`.sprite3`/`.pms`).
 *
 * A sprite archive is the same ZIP Scratch uses for `.sprite3`: `sprite.json`
 * plus content-addressed `<md5>.<ext>` assets at the archive root. PenguinMod
 * documents the same `sprite.json` target layout for saved sprites.
 */
import { unzipSync, zipSync } from "./sb3.js";
import { decompileProject } from "./decompiler.js";

const ASSET_NAME = /^[0-9a-f]{32}\.[a-z0-9]+$/i;

/** Asset filenames a sprite references through its costumes and sounds. */
export function spriteAssets(sprite) {
  const names = [];
  for (const asset of [...(sprite.costumes ?? []), ...(sprite.sounds ?? [])]) {
    if (asset && asset.md5ext) names.push(asset.md5ext);
  }
  return [...new Set(names)];
}

/** Decompile one sprite target into standalone `.tfx` source. */
export function spriteSource(sprite, options) {
  return decompileProject({ targets: [sprite] }, options);
}

/** Pack a sprite target and its assets into a `.pms` archive. */
export function spriteArchive(sprite, assets) {
  const files = [
    { name: "sprite.json", data: Buffer.from(JSON.stringify(sprite)) },
  ];
  for (const name of spriteAssets(sprite)) {
    if (!ASSET_NAME.test(name))
      throw new Error(`Unsafe asset name ${JSON.stringify(name)}`);
    const data = assets.get(name);
    if (!data)
      throw new Error(
        `Missing asset ${name} for sprite ${JSON.stringify(sprite.name)}`,
      );
    files.push({ name, data });
  }
  return zipSync(files);
}

/**
 * Read a `.sprite3`/`.pms` archive, or bare `sprite.json` with no assets.
 * @param {Buffer|Uint8Array} input
 * @returns {{sprite: object, assets: Map<string, Buffer>}}
 */
export function readSprite(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const text = bytes.toString("utf8").trimStart();
  const assets = new Map();

  let sprite;
  if (text.startsWith("{")) {
    sprite = JSON.parse(text);
    if (spriteAssets(sprite).length > 0)
      throw new Error(
        "That JSON has costumes or sounds but no assets; use the .sprite3/.pms archive",
      );
  } else {
    const files = unzipSync(bytes);
    const json = files.get("sprite.json");
    if (!json) throw new Error("Not a sprite archive: missing sprite.json");
    sprite = JSON.parse(json.toString("utf8"));
    for (const name of spriteAssets(sprite)) {
      if (!ASSET_NAME.test(name))
        throw new Error(`Unsafe asset name ${JSON.stringify(name)}`);
      const data = files.get(name);
      if (!data) throw new Error(`Sprite archive is missing asset ${name}`);
      assets.set(name, data);
    }
  }

  if (!sprite || typeof sprite !== "object" || Array.isArray(sprite))
    throw new Error("sprite.json must contain a target object");
  if (sprite.isStage) throw new Error("That archive is a stage, not a sprite");
  if (!sprite.name) throw new Error("sprite.json has no name");
  return { sprite, assets };
}
