import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addProjectExtension, removeProjectExtension } from "../src/config.js";

function configFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-cfg-edit-"));
  const file = path.join(dir, "fx.yml");
  fs.writeFileSync(file, text);
  return {
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const BASE = `# Project settings
project:
  name: "Demo" # keep
  fps: 60

  extensions:
    # sources
    - "https://example.test/signals.js" # first
    - "./local.js"
  unsandboxed: [signals] # allow
`;

test("extension add keeps comments and formatting", () => {
  const { file, cleanup } = configFile(BASE);
  try {
    addProjectExtension(file, "./extra.js");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      `# Project settings
project:
  name: "Demo" # keep
  fps: 60

  extensions:
    # sources
    - "https://example.test/signals.js" # first
    - "./local.js"
    - "./extra.js"
  unsandboxed: [signals] # allow
`,
    );
  } finally {
    cleanup();
  }
});

test("extension remove keeps comments and formatting", () => {
  const { file, cleanup } = configFile(BASE);
  try {
    removeProjectExtension(file, "signals");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      `# Project settings
project:
  name: "Demo" # keep
  fps: 60

  extensions:
    # sources
    - "./local.js"
  unsandboxed: [] # allow
`,
    );
  } finally {
    cleanup();
  }
});

test("adding to a project without an extensions key appends a block", () => {
  const { file, cleanup } = configFile(`# top
project:
  name: "Demo" # keep
`);
  try {
    addProjectExtension(file, "./a.js");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      `# top
project:
  name: "Demo" # keep
  extensions:
    - "./a.js"
`,
    );
  } finally {
    cleanup();
  }
});

test("adding to an inline list keeps the comment on that line", () => {
  const { file, cleanup } = configFile(
    `project:\n  extensions: ["./a.js"] # keep me\n`,
  );
  try {
    addProjectExtension(file, "./b.js");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      `project:\n  extensions: ["./a.js", "./b.js"] # keep me\n`,
    );
  } finally {
    cleanup();
  }
});

test("removing the last block item leaves an empty list", () => {
  const { file, cleanup } = configFile(
    `project:\n  extensions:\n    - "./only.js"\n`,
  );
  try {
    removeProjectExtension(file, "./only.js");
    assert.equal(fs.readFileSync(file, "utf8"), `project:\n  extensions: []\n`);
  } finally {
    cleanup();
  }
});

test("adding an existing extension leaves the file untouched", () => {
  const { file, cleanup } = configFile(BASE);
  try {
    addProjectExtension(file, "https://example.test/signals.js");
    assert.equal(fs.readFileSync(file, "utf8"), BASE);
  } finally {
    cleanup();
  }
});
