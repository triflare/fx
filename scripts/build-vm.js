#!/usr/bin/env node
/**
 * Build the vendored PenguinMod VM and copy its Node bundle into
 * `vendor/pm-vm-dist`.
 *
 * The VM is a git submodule pinned to the commit Triflare Fx supports and is
 * not an npm dependency. Its Node build keeps a handful of libraries external;
 * those are runtime dependencies of Triflare Fx. The bundle is produced with
 * the webpack API and a small entry that exports the VM, its dispatch
 * singleton, and the extension API used by the tests.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBMODULE = path.join(ROOT, "vendor", "pm-vm");
const OUTPUT = path.join(ROOT, "vendor", "pm-vm-dist");
const ENTRY = path.join(ROOT, "scripts", "vm-entry.cjs");
const BUNDLE = path.join(OUTPUT, "dist", "scratch-vm.js");
const MARKER = path.join(OUTPUT, ".fx-build.json");

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

/** Libraries the VM's Node build expects the host to provide. */
const EXTERNALS = [
  "decode-html",
  "format-message",
  "htmlparser2",
  "immutable",
  "jszip",
  "minilog",
  "scratch-parser",
  "text-encoding",
];

/** Build-only tools; the VM repository has no lockfile to install from. */
const BUILD_DEPENDENCIES = [
  "webpack@4.47.0",
  "babel-loader@8.2.2",
  "@babel/core@7.13.10",
  "@babel/preset-env@7.14.8",
  "file-loader@2.0.0",
];

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

/**
 * `npm` is a `.cmd` shim on Windows, which `execFileSync` cannot launch
 * directly, so hand it to the command processor there.
 * @returns {{command: string, args: string[]}}
 */
function npmLauncher() {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm"],
    };
  }
  return { command: "npm", args: [] };
}

function installDependencies() {
  const shared = [
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--legacy-peer-deps",
  ];
  const npm = npmLauncher();
  log("installing VM runtime dependencies");
  run(npm.command, [...npm.args, "install", "--omit=dev", ...shared], {
    cwd: SUBMODULE,
  });
  log("installing VM build tools");
  run(
    npm.command,
    [...npm.args, "install", "--no-save", ...shared, ...BUILD_DEPENDENCIES],
    { cwd: SUBMODULE },
  );
}

/** @param {ReturnType<typeof createRequire>} requireFromVm */
function webpackConfig(requireFromVm) {
  return {
    mode: "production",
    devtool: false,
    target: "node",
    context: SUBMODULE,
    entry: { "scratch-vm": ENTRY },
    output: {
      path: path.join(SUBMODULE, "dist", "node"),
      filename: "[name].js",
      library: "VirtualMachine",
      libraryTarget: "commonjs2",
      // webpack 4 defaults to md4, which Node 17+ no longer provides.
      hashFunction: "md5",
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: "babel-loader",
          include: [
            path.join(SUBMODULE, "src"),
            /node_modules[\\/]scratch-[^\\/]+[\\/]src/,
          ],
          options: {
            babelrc: false,
            configFile: false,
            presets: [[requireFromVm.resolve("@babel/preset-env")]],
          },
        },
        {
          test: /\.mp3$/,
          loader: "file-loader",
          options: { outputPath: "media/music/" },
        },
        {
          test: /\.(svg|png|wav|gif|jpg|mp3|ttf|otf|ico)$/,
          loader: "file-loader",
          options: { outputPath: "static/assets/" },
        },
      ],
    },
    resolve: {
      modules: [path.join(SUBMODULE, "node_modules"), "node_modules"],
    },
    resolveLoader: {
      modules: [path.join(SUBMODULE, "node_modules"), "node_modules"],
    },
    externals: Object.fromEntries(EXTERNALS.map((name) => [name, true])),
    node: { __dirname: false },
  };
}

/** @param {ReturnType<typeof createRequire>} requireFromVm */
function build(requireFromVm) {
  const webpack = requireFromVm("webpack");
  return new Promise((resolve, reject) => {
    webpack(webpackConfig(requireFromVm), (error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      if (stats.hasErrors()) {
        reject(
          new Error(
            stats.toString({
              all: false,
              errors: true,
              errorDetails: true,
            }),
          ),
        );
        return;
      }
      log(
        stats.toString({
          colors: false,
          modules: false,
          children: false,
          entrypoints: false,
        }),
      );
      resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(path.join(SUBMODULE, "package.json"))) {
    log("initializing vendor/pm-vm submodule");
    run("git", [
      "-C",
      ROOT,
      "submodule",
      "update",
      "--init",
      "--recursive",
      "--",
      "vendor/pm-vm",
    ]);
  }

  const commit = git(["-C", "vendor/pm-vm", "rev-parse", "HEAD"]);
  const upstream = readJson(path.join(SUBMODULE, "package.json"));
  // Hash source bytes so EXTERNALS, BUILD_DEPENDENCIES, webpackConfig, and
  // build logic are covered without embedding checkout-specific absolute paths.
  const inputHash = createHash("sha256")
    .update(fs.readFileSync(fileURLToPath(import.meta.url)))
    .update(fs.readFileSync(ENTRY))
    .digest("hex");

  if (!force && fs.existsSync(BUNDLE) && fs.existsSync(MARKER)) {
    try {
      const marker = readJson(MARKER);
      if (
        marker.commit === commit &&
        marker.version === upstream.version &&
        marker.inputHash === inputHash
      ) {
        log(`vm ${upstream.version} (${commit.slice(0, 12)}) is up to date`);
        return;
      }
    } catch {
      // A corrupt marker just means we rebuild.
    }
  }

  installDependencies();

  log(`building vm ${upstream.version} (${commit.slice(0, 12)})`);
  const requireFromVm = createRequire(path.join(SUBMODULE, "package.json"));
  await build(requireFromVm);

  const dist = path.join(SUBMODULE, "dist", "node");
  if (!fs.existsSync(path.join(dist, "scratch-vm.js")))
    throw new Error(`VM build did not produce ${dist}/scratch-vm.js`);

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
    `This directory contains the PenguinMod VM.

Upstream: https://github.com/PenguinMod/PenguinMod-Vm
Version: ${upstream.version}
Commit: ${commit}
License: BSD-3-Clause (see LICENSE)
`,
  );
  fs.writeFileSync(
    MARKER,
    `${JSON.stringify(
      {
        name: upstream.name,
        version: upstream.version,
        commit,
        inputHash,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  log(`copied vm to ${path.relative(ROOT, OUTPUT)}`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[fx] ${error.stack ?? error}\n`);
  process.exit(1);
}
