import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "../src/sb3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");
const ASSET = `${"a".repeat(32)}.svg`;
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-cli-"));
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function project() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
  return dir;
}

function writeSprite3(dir) {
  const sprite = {
    isStage: false,
    name: "Robot",
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [
      {
        name: "robot",
        dataFormat: "svg",
        assetId: "a".repeat(32),
        md5ext: ASSET,
        rotationCenterX: 5,
        rotationCenterY: 5,
      },
    ],
    sounds: [],
    volume: 100,
    layerOrder: 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: "all around",
  };
  const file = path.join(dir, "robot.sprite3");
  fs.writeFileSync(
    file,
    zipSync([
      { name: "sprite.json", data: Buffer.from(JSON.stringify(sprite)) },
      { name: ASSET, data: SVG },
    ]),
  );
  return file;
}

test("extension add, list and remove edit fx.yml", () => {
  const dir = project();
  try {
    const added = run(
      [
        "extension",
        "add",
        "https://example.test/signals.js",
        "--unsandboxed",
        "signals",
      ],
      dir,
    );
    assert.equal(added.status, 0, added.stderr);

    const config = fs.readFileSync(path.join(dir, "fx.yml"), "utf8");
    assert.match(config, /https:\/\/example\.test\/signals\.js/);
    assert.match(config, /unsandboxed:\n\s+- "?signals"?/);

    const listed = run(["extension", "list", "--json"], dir);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), {
      extensions: ["https://example.test/signals.js"],
      unsandboxed: ["signals"],
    });

    const removed = run(["extension", "remove", "signals"], dir);
    assert.equal(removed.status, 0, removed.stderr);
    const after = fs.readFileSync(path.join(dir, "fx.yml"), "utf8");
    assert.doesNotMatch(after, /signals/);

    assert.equal(run(["extension", "remove", "signals"], dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sprite add imports a sprite3 as source and assets", () => {
  const dir = project();
  try {
    writeSprite3(dir);
    const added = run(["sprite", "add", "robot.sprite3"], dir);
    assert.equal(added.status, 0, added.stderr);

    const file = path.join(dir, "src", "robot.tfx");
    assert.ok(fs.existsSync(file), "src/robot.tfx should exist");
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /sprite "Robot" \{/);
    assert.match(source, /"\.\.\/assets\/a{32}\.svg"/);
    assert.ok(fs.existsSync(path.join(dir, "assets", ASSET)));

    const listed = run(["sprite", "list", "--json"], dir);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), [
      {
        name: "Robot",
        file: path.join("src", "robot.tfx"),
        files: [path.join("src", "robot.tfx")],
        partial: false,
      },
    ]);

    const built = run(["build"], dir);
    assert.equal(built.status, 0, built.stderr);
    assert.ok(fs.existsSync(path.join(dir, "build", "demo.pmp")));

    // A second import of the same name is refused.
    assert.equal(run(["sprite", "add", "robot.sprite3"], dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sprite build writes a single-sprite .pms archive", () => {
  const dir = project();
  try {
    writeSprite3(dir);
    assert.equal(run(["sprite", "add", "robot.sprite3"], dir).status, 0);

    const built = run(["sprite", "build", "Robot", "-o", "robot.pms"], dir);
    assert.equal(built.status, 0, built.stderr);

    const archive = unzipSync(fs.readFileSync(path.join(dir, "robot.pms")));
    const sprite = JSON.parse(archive.get("sprite.json").toString("utf8"));
    assert.equal(sprite.name, "Robot");
    assert.equal(sprite.isStage, false);
    // The compiler re-hashes the costume, so the archive uses the new name.
    const asset = sprite.costumes[0].md5ext;
    assert.match(asset, /^[0-9a-f]{32}\.svg$/);
    assert.deepEqual([...archive.keys()].sort(), ["sprite.json", asset].sort());

    const missing = run(["sprite", "build", "Nope"], dir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Available: Robot/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sprite remove deletes an imported sprite file", () => {
  const dir = project();
  try {
    writeSprite3(dir);
    assert.equal(run(["sprite", "add", "robot.sprite3"], dir).status, 0);

    const removed = run(["sprite", "remove", "Robot"], dir);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!fs.existsSync(path.join(dir, "src", "robot.tfx")));
    assert.equal(run(["sprite", "remove", "Robot"], dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("partial sprite fragments build, check, list and remove together", () => {
  const dir = project();
  try {
    fs.writeFileSync(
      path.join(dir, "fx.yml"),
      'project:\n  name: "Demo"\nfx:\n  partialSprites: true\n',
    );
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "base.tfx"),
      'sprite "Cat" { let lives = 9; }',
    );
    fs.writeFileSync(
      path.join(dir, "src", "fragment.tfx"),
      'partial sprite "Cat" { when greenFlag { looks.show(); } }',
    );

    const checked = run(["check"], dir);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(run(["check", "--no-config"], dir).status, 1);

    const built = run(["build"], dir);
    assert.equal(built.status, 0, built.stderr);

    const listed = run(["sprite", "list", "--json"], dir);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), [
      {
        name: "Cat",
        file: path.join("src", "base.tfx"),
        files: [path.join("src", "base.tfx"), path.join("src", "fragment.tfx")],
        partial: false,
      },
    ]);

    const removed = run(["sprite", "remove", "Cat"], dir);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!fs.existsSync(path.join(dir, "src", "base.tfx")));
    assert.ok(!fs.existsSync(path.join(dir, "src", "fragment.tfx")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sprite remove refuses a sprite that shares a file", () => {
  const dir = project();
  try {
    const file = path.join(dir, "src", "pair.tfx");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      'sprite "A" { when greenFlag { looks.show(); } }\n' +
        'sprite "B" { when greenFlag { looks.hide(); } }\n',
    );

    const removed = run(["sprite", "remove", "A"], dir);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /remove the sprite block by hand/);
    assert.ok(fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
