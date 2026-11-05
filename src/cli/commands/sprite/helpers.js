import fs from "node:fs";
import path from "node:path";
import { parse } from "../../../parser.js";
import { discoverSources } from "../../../project.js";
import { sourceDirectory } from "../../../brand.js";

/** Read a local file or download a remote sprite archive. */
export async function readInputBytes(source, cwd = process.cwd()) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Could not download ${source}: ${response.status} ${response.statusText}`,
      );
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.readFileSync(path.resolve(cwd, source));
}

/** Every sprite declaration under `dir`, in source order. */
export function spriteNames(dir) {
  const sprites = [];
  for (const file of discoverSources(dir)) {
    const ast = parse(fs.readFileSync(file, "utf8"), file);
    for (const sprite of ast.sprites) {
      sprites.push({ name: sprite.name, file, partial: sprite.partial });
    }
  }
  return sprites;
}

/** Group sprite declarations by name, tracking the base declaration. */
export function spriteGroups(dir) {
  const groups = new Map();
  for (const entry of spriteNames(dir)) {
    let group = groups.get(entry.name);
    if (!group) {
      group = {
        name: entry.name,
        file: entry.file,
        files: [],
        partial: true,
      };
      groups.set(entry.name, group);
    }
    group.files.push(entry.file);
    if (!entry.partial) {
      group.file = entry.file;
      group.partial = false;
    }
  }
  for (const group of groups.values())
    group.files = [...new Set([group.file, ...group.files])];
  return [...groups.values()];
}

/** Root directory that owns sources and assets. */
export function spriteRoot(cwd, configPath) {
  return configPath ? path.dirname(configPath) : cwd;
}

export function spriteSourceDir(rootDir, product) {
  return path.join(rootDir, sourceDirectory(product));
}
