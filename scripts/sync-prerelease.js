#!/usr/bin/env node
/**
 * Merge the latest stable release into a prerelease branch before release.
 *
 * semantic-release derives a prerelease version from the tags reachable from
 * the branch (`git tag --merged`). A stable release published on `latest` is
 * invisible to `alpha` and `beta` until `latest` is merged back into them, so
 * without this the branches keep numbering from their old baseline
 * (`2.2.0-alpha.6`, `2.2.0-alpha.7`, ...) instead of bumping the version that
 * actually shipped (`2.3.0-alpha.1`).
 *
 * The merge is created locally and left for semantic-release to push together
 * with the release commit and tag. Conflicts are only accepted in the files
 * semantic-release rewrites, and any other conflict aborts the release so a
 * person resolves it. `CHANGELOG.md` keeps the release sections of both sides
 * (each branch prepends its own releases, so taking one side would drop the
 * stable ones for good); the version files keep the prerelease branch's copy,
 * which semantic-release overwrites anyway.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const STABLE_BRANCH = "latest";
const PRERELEASE_BRANCHES = new Set(["alpha", "beta"]);
const CHANGELOG_FILE = "CHANGELOG.md";
const REGENERATED_FILES = new Set([
  CHANGELOG_FILE,
  "package.json",
  "package-lock.json",
  "product.yml",
]);
const RELEASE_HEADING = /^## \[([^\]]+)\]\([^)]*\) \((\d{4}-\d{2}-\d{2})\)$/;
// The identity semantic-release uses for its own release commit.
const IDENTITY = [
  "-c",
  "user.name=semantic-release-bot",
  "-c",
  "user.email=32174276+semantic-release-bot@users.noreply.github.com",
];

const branch = process.env.GITHUB_REF_NAME;

if (!branch || !PRERELEASE_BRANCHES.has(branch)) {
  process.stdout.write(
    `[fx] ${branch ?? "unknown branch"} is not a prerelease branch; nothing to sync\n`,
  );
  process.exit(0);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function mergeInProgress() {
  try {
    git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function abortUnresolvable(files) {
  git(["merge", "--abort"], { stdio: "inherit" });
  throw new Error(
    `[fx] cannot sync ${branch} with ${STABLE_BRANCH}; resolve these ` +
      `conflicts manually: ${files}`,
  );
}

/**
 * Split a changelog into its release sections and the text around them.
 *
 * @param {string} content
 * @returns {{ head: string, releases: { version: string, date: string, text: string }[], tail: string }}
 */
function readChangelog(content) {
  const lines = content.split("\n");
  const headings = [];
  let tailStart = -1;

  lines.forEach((line, index) => {
    const match = RELEASE_HEADING.exec(line);
    if (match) {
      headings.push({ index, version: match[1], date: match[2] });
    } else if (
      tailStart === -1 &&
      headings.length > 0 &&
      line.startsWith("# ")
    ) {
      // A level-one heading after the releases is the file's own preamble
      // ("# Changelog" and its description); it does not belong to a release.
      tailStart = index;
    }
  });

  if (headings.length === 0) {
    throw new Error(`${CHANGELOG_FILE} has no release sections`);
  }

  const end = tailStart === -1 ? lines.length : tailStart;
  const releases = headings
    .filter((heading) => heading.index < end)
    .map((heading, index, visible) => ({
      version: heading.version,
      date: heading.date,
      text: lines
        .slice(heading.index, visible[index + 1]?.index ?? end)
        .join("\n")
        .trim(),
    }));

  return {
    head: lines.slice(0, headings[0].index).join("\n").trim(),
    releases,
    tail: lines.slice(end).join("\n").trim(),
  };
}

/** Compare two release versions, e.g. `2.2.0` and `2.2.0-beta.1`. */
function compareVersions(left, right) {
  const [leftCore, leftPre = ""] = left.split("-");
  const [rightCore, rightPre = ""] = right.split("-");
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  if (leftPre === "" || rightPre === "") {
    return leftPre === rightPre ? 0 : leftPre === "" ? 1 : -1;
  }

  const [leftTag, leftNumber = "0"] = leftPre.split(".");
  const [rightTag, rightNumber = "0"] = rightPre.split(".");
  if (leftTag !== rightTag) return leftTag < rightTag ? -1 : 1;
  return Number(leftNumber) - Number(rightNumber);
}

/**
 * Merge two changelogs into one list of releases, newest first.
 *
 * Release sections are identified by `## [version](...) (date)`, so both
 * branches' releases survive and duplicated versions keep the prerelease copy.
 *
 * @param {string} ours the prerelease branch's changelog
 * @param {string} theirs the stable branch's changelog
 */
function mergeChangelogs(ours, theirs) {
  const base = readChangelog(ours);
  const releases = new Map();

  for (const release of [...base.releases, ...readChangelog(theirs).releases]) {
    if (!releases.has(release.version)) releases.set(release.version, release);
  }

  const ordered = [...releases.values()].sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    return compareVersions(right.version, left.version);
  });

  return `${[base.head, ...ordered.map((release) => release.text), base.tail]
    .filter(Boolean)
    .join("\n\n")}\n`;
}

/** Resolve conflicts in files semantic-release rewrites after this step. */
function resolveRegeneratedConflicts() {
  const conflicted = git(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
  const unexpected = conflicted.filter((file) => !REGENERATED_FILES.has(file));

  if (conflicted.length === 0 || unexpected.length > 0) {
    abortUnresolvable(
      unexpected.length > 0 ? unexpected.join(", ") : "(no conflicted files)",
    );
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sync-"));
  try {
    for (const file of conflicted) {
      let stages;
      try {
        stages = [1, 2, 3].map((stage) => {
          const target = path.join(
            directory,
            `${stage}-${path.basename(file)}`,
          );
          fs.writeFileSync(target, git(["show", `:${stage}:${file}`]));
          return target;
        });
      } catch {
        abortUnresolvable(file);
      }

      if (file === CHANGELOG_FILE) {
        try {
          fs.writeFileSync(
            file,
            mergeChangelogs(
              fs.readFileSync(stages[1], "utf8"),
              fs.readFileSync(stages[2], "utf8"),
            ),
          );
        } catch {
          abortUnresolvable(file);
        }
        git(["add", "--", file]);
        process.stdout.write(`[fx] kept both sides' releases in ${file}\n`);
        continue;
      }

      // Keep the prerelease branch's content at each conflict (its version
      // files are rewritten by semantic-release anyway) while still taking
      // non-conflicting changes from latest.
      const resolved = execFileSync(
        "git",
        ["merge-file", "--ours", "--stdout", stages[1], stages[0], stages[2]],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      fs.writeFileSync(file, resolved);
      git(["add", "--", file]);
      process.stdout.write(`[fx] resolved ${file} in favour of ${branch}\n`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

git(
  [
    "fetch",
    "--no-recurse-submodules",
    "--tags",
    "origin",
    `+refs/heads/${STABLE_BRANCH}:refs/remotes/origin/${STABLE_BRANCH}`,
  ],
  { stdio: "inherit" },
);

const stableRef = `origin/${STABLE_BRANCH}`;

try {
  git(["merge-base", "--is-ancestor", stableRef, "HEAD"]);
  process.stdout.write(
    `[fx] ${branch} already contains ${stableRef}; nothing to sync\n`,
  );
  process.exit(0);
} catch {
  // The stable release has commits this prerelease branch lacks.
}

const message = `chore: sync ${branch} with ${STABLE_BRANCH}`;

// Resolutions must always come from this script. With `rerere` enabled, git
// replays cached resolutions for these same conflicts and stages them as
// resolved, so the merges below never run and a stale changelog resolution
// (one that dropped the stable releases) would be reused.
try {
  git(
    [
      "-c",
      "rerere.enabled=false",
      "merge",
      "--no-ff",
      "-m",
      message,
      stableRef,
    ],
    {
      stdio: "inherit",
    },
  );
} catch (error) {
  if (!mergeInProgress()) throw error;
  resolveRegeneratedConflicts();
  git([...IDENTITY, "commit", "--no-edit"], { stdio: "inherit" });
}

if (fs.existsSync(".gitmodules")) {
  git(["submodule", "update", "--init", "--recursive"], { stdio: "inherit" });
}

process.stdout.write(`[fx] ${branch} now includes ${STABLE_BRANCH}\n`);
