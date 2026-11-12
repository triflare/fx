#!/usr/bin/env node
/**
 * Fail a release when a version file disagrees with the version
 * semantic-release computed.
 *
 * `scripts/set-version.js` rewrites every place Fx publishes a version. This
 * runs immediately after it and asserts the rewrite actually landed, so a
 * missing file or partial write fails the release before npm or the VS Code
 * Marketplace sees it. semantic-release derives its tag from the same value, so
 * a passing check means the tag, the package, and `fx --version` agree.
 *
 * Pre-release channels leave the VS Code extension on its last stable version
 * (the Marketplace stores no semantic version pre-releases), so the extension
 * is only held to the exact version on stable releases. On alpha and beta it
 * must still be a stable version.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadProduct } from "../src/product.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requested = process.argv[2];
if (!requested) {
  process.stderr.write("[fx] usage: node scripts/check-version.js <version>\n");
  process.exit(1);
}

// Accept the release tag (`v1.2.3`) or the bare version semantic-release
// exposes as `nextRelease.version`.
const version = requested.replace(/^v/, "");
const stable = !version.includes("-");

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

const failures = [];

function expect(label, actual) {
  if (actual !== version)
    failures.push(`${label}: expected ${version}, found ${actual ?? "(none)"}`);
}

expect("product.yml", loadProduct().version);
expect("package.json", readJson("package.json").version);

const rootLock = readJson("package-lock.json");
expect("package-lock.json", rootLock.version);
expect('package-lock.json packages[""]', rootLock.packages?.[""]?.version);

const extension = readJson(path.join("editors", "vscode", "package.json"));
const extensionLock = readJson(
  path.join("editors", "vscode", "package-lock.json"),
);

if (stable) {
  expect("editors/vscode/package.json", extension.version);
  expect("editors/vscode/package-lock.json", extensionLock.version);
  expect(
    'editors/vscode/package-lock.json packages[""]',
    extensionLock.packages?.[""]?.version,
  );
} else if (!/^\d+\.\d+\.\d+$/.test(extension.version ?? "")) {
  failures.push(
    "editors/vscode/package.json: expected a stable version on a " +
      `pre-release, found ${extension.version ?? "(none)"}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`[fx] version check failed for ${version}:\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `[fx] ${version} matches product.yml and package manifests\n`,
);
if (!stable) {
  process.stdout.write(
    `[fx] VS Code extension stays at ${extension.version} on pre-releases\n`,
  );
}
