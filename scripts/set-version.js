#!/usr/bin/env node
/**
 * Write the version semantic-release computed into every place Triflare Fx
 * publishes it.
 *
 * The CLI reports `product.yml`'s version at runtime, and the VS Code extension
 * carries its own package manifest, so updating `package.json` alone is not
 * enough. `@semantic-release/npm` owns `package.json`; this script owns the rest
 * so a single release commit keeps all five files in step.
 *
 * The VS Code Marketplace cannot store semantic version pre-releases, so the
 * extension files are only updated for stable versions. Pre-release channels
 * (alpha and beta) leave the extension on its last stable version.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version) {
  process.stderr.write("[fx] usage: node scripts/set-version.js <version>\n");
  process.exit(1);
}

const stable = !version.includes("-");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Update a `package.json` and the two version fields of its lockfile. */
function setPackageVersion(manifest, lockfile) {
  const pkg = readJson(manifest);
  pkg.version = version;
  writeJson(manifest, pkg);

  const lock = readJson(lockfile);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeJson(lockfile, lock);
}

/**
 * Replace the `version:` line in product.yml. A YAML round-trip would drop the
 * file's comments, so the line is rewritten in place.
 */
function setProductVersion() {
  const file = path.join(ROOT, "product.yml");
  const source = fs.readFileSync(file, "utf8");
  const next = source.replace(
    /^(version:\s*).*$/m,
    (_match, prefix) => `${prefix}${JSON.stringify(version)}`,
  );
  if (next === source)
    throw new Error("product.yml has no version: line to update");
  fs.writeFileSync(file, next);
}

setPackageVersion(
  path.join(ROOT, "package.json"),
  path.join(ROOT, "package-lock.json"),
);
setProductVersion();

if (stable) {
  setPackageVersion(
    path.join(ROOT, "editors", "vscode", "package.json"),
    path.join(ROOT, "editors", "vscode", "package-lock.json"),
  );
} else {
  process.stdout.write(
    `[fx] ${version} is a pre-release; leaving the VS Code extension on its last stable version\n`,
  );
}
