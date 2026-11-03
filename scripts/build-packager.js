#!/usr/bin/env node
/**
 * Build the vendored PenguinMod Packager and copy its Node bundle into
 * `vendor/pm-packager-dist`.
 *
 * The packager is a git submodule, not an npm dependency (it is not published
 * to npm). Its own CI uses pnpm, so this script uses pnpm when available and
 * falls back to `npx pnpm@11`.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBMODULE = path.join(ROOT, "vendor", "pm-packager");
const OUTPUT = path.join(ROOT, "vendor", "pm-packager-dist");
const MARKER = path.join(OUTPUT, ".fx-build.json");

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

function log(message) {
  process.stdout.write(`[fx] ${message}\n`);
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    stdio: "inherit",
    ...options,
  });
}

function git(args_) {
  return execFileSync("git", ["-C", ROOT, ...args_], {
    encoding: "utf8",
  }).trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function pnpm() {
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore" });
    return { command: "pnpm", args: [] };
  } catch {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    return { command: npx, args: ["--yes", "pnpm@11"] };
  }
}

function main() {
  if (!fs.existsSync(path.join(SUBMODULE, "package.json"))) {
    log("initializing vendor/pm-packager submodule");
    run("git", [
      "-C",
      ROOT,
      "submodule",
      "update",
      "--init",
      "--recursive",
      "--",
      "vendor/pm-packager",
    ]);
  }

  const commit = git(["-C", "vendor/pm-packager", "rev-parse", "HEAD"]);
  const upstream = readJson(path.join(SUBMODULE, "package.json"));

  if (
    !force &&
    fs.existsSync(path.join(OUTPUT, "dist", "packager.js")) &&
    fs.existsSync(MARKER)
  ) {
    try {
      const marker = readJson(MARKER);
      if (marker.commit === commit && marker.version === upstream.version) {
        log(
          `packager ${upstream.version} (${commit.slice(0, 12)}) is up to date`,
        );
        return;
      }
    } catch {
      // A corrupt marker just means we rebuild.
    }
  }

  const packageManager = pnpm();
  const installArgs = [...packageManager.args, "install", "--frozen-lockfile"];
  const buildArgs = [...packageManager.args, "run", "build-node-prod"];

  log(`installing packager dependencies with ${packageManager.command}`);
  run(packageManager.command, installArgs, { cwd: SUBMODULE });

  log(`building packager ${upstream.version} (${commit.slice(0, 12)})`);
  run(packageManager.command, buildArgs, { cwd: SUBMODULE });

  const dist = path.join(SUBMODULE, "dist");
  if (!fs.existsSync(path.join(dist, "packager.js")))
    throw new Error(`Packager build did not produce ${dist}/packager.js`);

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.cpSync(dist, path.join(OUTPUT, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(SUBMODULE, "LICENSE"),
    path.join(OUTPUT, "LICENSE"),
  );
  fs.writeFileSync(
    path.join(OUTPUT, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUTPUT, "NOTICE"),
    `This directory contains the PenguinMod Packager.

Upstream: ${upstream.homepage ?? "https://github.com/PenguinMod/PenguinMod-Packager"}
Version: ${upstream.version}
Commit: ${commit}
License: Apache-2.0 (see LICENSE)
`,
  );
  fs.writeFileSync(
    MARKER,
    `${JSON.stringify(
      {
        name: upstream.name,
        version: upstream.version,
        commit,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  log(`copied packager to ${path.relative(ROOT, OUTPUT)}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[fx] ${error.stack ?? error}\n`);
  process.exit(1);
}
