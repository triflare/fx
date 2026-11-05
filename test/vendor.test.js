import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { loadConfigFrom, parseConfig } from "../src/config.js";
import {
  addVendorEntry,
  removeProjectExtensions,
  removeVendorEntry,
} from "../src/config-edit.js";
import { readExtensionDataUri } from "../src/extensions.js";
import { unzipSync } from "../src/sb3.js";
import {
  VendorError,
  installVendor,
  installVendorEntry,
  loadVendorExtensions,
  migrateProjectExtensions,
  outdatedVendor,
  readLock,
  removeVendoredExtension,
  resolveVendorFiles,
  sha256,
  updateVendor,
  verifyVendor,
} from "../src/vendor.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

const SIGNALS = `
(function (Scratch) {
  'use strict';
  class Signals {
    getInfo () {
      return {
        id: 'signals',
        name: 'Signals',
        blocks: [
          {opcode: 'send', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG]',
           arguments: {MSG: {type: Scratch.ArgumentType.STRING, defaultValue: 'hi'}}}
        ]
      };
    }
    send () {}
  }
  Scratch.extensions.register(new Signals());
})(Scratch);
`;

const UNSANDBOXED = `
(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('"Demo" must run unsandboxed');
  }
  Scratch.extensions.register({
    getInfo () {
      return {
        id: 'demo',
        name: 'Demo',
        blocks: [{opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}]
      };
    },
    go () {}
  });
})(Scratch);
`;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-vendor-"));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function project({
  config = 'project:\n  name: "Vendor"\n',
  extensions = {},
} = {}) {
  const dir = tmp();
  write(path.join(dir, "fx.yml"), config);
  write(path.join(dir, "stage.tfx"), "stage {\n}\n");
  for (const [name, source] of Object.entries(extensions))
    write(path.join(dir, name), source);
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("parses vendor entries in load order with shorthand and options", () => {
  const config = parseConfig(`
vendorDir: deps/extensions
vendor:
  signals: https://example.test/signals.js
  local:
    url: ./src/local.js
    unsandboxed: true
  flaky: http://localhost:8080/flaky.js
  embedded: "data:text/javascript,Scratch.extensions.register({getInfo(){return {id:'x'}}})"
`);
  assert.equal(config.vendorDir, "deps/extensions");
  assert.deepEqual(
    config.vendor.map((entry) => entry.name),
    ["signals", "local", "flaky", "embedded"],
  );
  const [signals, local, flaky, embedded] = config.vendor;
  assert.equal(signals.remote, true);
  assert.equal(signals.local, false);
  assert.equal(signals.volatile, false);
  assert.equal(local.local, true);
  assert.equal(local.unsandboxed, true);
  assert.equal(flaky.volatile, true);
  assert.equal(embedded.data, true);
  assert.equal(embedded.remote, false);
  assert.equal(embedded.local, false);
  assert.throws(() => parseConfig("vendor: true\n"), /must be a mapping/);
});

test("vendor edits preserve comments and remove the section cleanly", () => {
  const dir = tmp();
  const configPath = path.join(dir, "fx.yml");
  write(
    configPath,
    `# top
project:
  name: "Demo"

vendor:
  # remote extension
  signals: "https://example.test/signals.js" # keep
`,
  );

  addVendorEntry(configPath, "local", "./local.js", {
    unsandboxed: true,
    volatile: true,
  });
  assert.equal(
    fs.readFileSync(configPath, "utf8"),
    `# top
project:
  name: "Demo"

vendor:
  # remote extension
  signals: "https://example.test/signals.js" # keep
  local:
    url: "./local.js"
    unsandboxed: true
    volatile: true
`,
  );

  assert.equal(
    removeVendorEntry(configPath, "signals").removed,
    "https://example.test/signals.js",
  );
  assert.equal(removeVendorEntry(configPath, "local").removed, "./local.js");
  assert.match(fs.readFileSync(configPath, "utf8"), /vendor: \{\}/);
});

test("expands inline vendor mappings and keeps every entry", () => {
  const dir = tmp();
  const configPath = path.join(dir, "fx.yml");
  write(
    configPath,
    `project:\n  name: "Demo"\nvendor: { signals: "https://example.test/signals.js", other: "./other.js" } # keep\n`,
  );
  try {
    addVendorEntry(configPath, "local", "./local.js", { volatile: true });
    let parsed = parseConfig(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(
      parsed.vendor.map((entry) => entry.name),
      ["signals", "other", "local"],
    );
    assert.equal(parsed.vendor[2].volatile, true);
    assert.match(fs.readFileSync(configPath, "utf8"), /# keep/);

    removeVendorEntry(configPath, "signals");
    assert.match(fs.readFileSync(configPath, "utf8"), /# keep/);
    parsed = parseConfig(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(
      parsed.vendor.map((entry) => entry.name),
      ["other", "local"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removing project.extensions drops the key entirely", () => {
  const dir = tmp();
  const configPath = path.join(dir, "fx.yml");
  write(
    configPath,
    `project:
  name: "Demo"
  extensions:
    # legacy sources
    - "./a.js"
    - "./b.js"
  unsandboxed:
    - demo
`,
  );
  assert.deepEqual(removeProjectExtensions(configPath), ["./a.js", "./b.js"]);
  assert.equal(
    fs.readFileSync(configPath, "utf8"),
    `project:
  name: "Demo"
  unsandboxed:
    - demo
`,
  );
});

test("installs a local extension, locks it and embeds it in builds", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const configPath = path.join(dir, "fx.yml");
  try {
    const result = await installVendorEntry({
      configPath,
      configDir: dir,
      name: "local",
      source: "./local.js",
    });
    assert.equal(result.file, "extensions/local.js");

    const vendored = fs.readFileSync(
      path.join(dir, "extensions", "local.js"),
      "utf8",
    );
    assert.match(vendored, /^\/\/ generated from \.\/local\.js, do not edit\n/);
    assert.ok(vendored.endsWith(SIGNALS));

    const lock = readLock(dir);
    assert.equal(lock.extensions.local.local, true);
    assert.equal(lock.extensions.local.remote, false);
    assert.equal(lock.extensions.local.source, "./local.js");
    assert.equal(lock.extensions.local.sha256, sha256(vendored));

    const loaded = loadConfigFrom(dir);
    assert.deepEqual(
      loaded.vendor.map((entry) => entry.name),
      ["local"],
    );
    const extensions = await loadVendorExtensions({
      configDir: dir,
      config: loaded,
      fetchImpl: () => {
        throw new Error("builds must not fetch vendored files");
      },
    });
    assert.ok(
      extensions.extensionUrls.signals.startsWith(
        "data:text/javascript;base64,",
      ),
    );
    assert.equal(
      readExtensionDataUri(extensions.extensionUrls.signals),
      vendored,
    );
    assert.ok(extensions.catalog["signals.send"]);

    const built = build({
      dir,
      projectConfig: loaded.project,
      fxConfig: loaded.fx,
      catalog: extensions.catalog,
      extensionUrls: extensions.extensionUrls,
      useConfigFile: false,
    });
    const archived = JSON.parse(
      unzipSync(built.sb3).get("project.json").toString("utf8"),
    );
    assert.deepEqual(archived.extensions, ["signals"]);
    assert.equal(
      readExtensionDataUri(archived.extensionURLs.signals),
      vendored,
    );
    assert.doesNotMatch(archived.extensionURLs.signals, /local\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("builds refresh local vendored copies from their source", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const configPath = path.join(dir, "fx.yml");
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "local",
      source: "./local.js",
    });
    const before = readLock(dir).extensions.local.sha256;

    const changed = SIGNALS.replace("name: 'Signals'", "name: 'Signals v2'");
    write(path.join(dir, "local.js"), changed);
    const loaded = loadConfigFrom(dir);
    await loadVendorExtensions({ configDir: dir, config: loaded });

    const vendored = fs.readFileSync(
      path.join(dir, "extensions", "local.js"),
      "utf8",
    );
    assert.match(vendored, /Signals v2/);
    const after = readLock(dir).extensions.local.sha256;
    assert.notEqual(after, before);
    assert.equal(after, sha256(vendored));
    assert.equal(verifyVendor({ configDir: dir, config: loaded }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("remote files are verified offline and restore only when missing", async () => {
  const dir = project();
  const configPath = path.join(dir, "fx.yml");
  try {
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(SIGNALS),
      };
    };
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "signals",
      source: "https://example.test/signals.js",
      fetchImpl,
    });
    assert.equal(fetches, 1);
    const lock = readLock(dir);
    assert.equal(lock.extensions.signals.remote, true);
    assert.equal(lock.extensions.signals.volatile, false);

    const loaded = loadConfigFrom(dir);
    fetches = 0;
    await loadVendorExtensions({
      configDir: dir,
      config: loaded,
      fetchImpl: () => {
        fetches += 1;
        throw new Error("should not fetch when the file exists");
      },
    });
    assert.equal(fetches, 0);

    const vendored = path.join(dir, "extensions", "signals.js");
    fs.appendFileSync(vendored, "\n// tampered\n");
    const result = verifyVendor({ configDir: dir, config: loaded });
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /does not match fx\.lock/);
    await assert.rejects(
      loadVendorExtensions({
        configDir: dir,
        config: loaded,
        fetchImpl,
      }),
      VendorError,
    );

    fs.rmSync(vendored);
    fetches = 0;
    await loadVendorExtensions({ configDir: dir, config: loaded, fetchImpl });
    assert.equal(fetches, 1);
    assert.ok(fs.existsSync(vendored));

    fs.rmSync(vendored);
    const changedFetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(`${SIGNALS}\n// changed upstream\n`),
    });
    await assert.rejects(
      loadVendorExtensions({
        configDir: dir,
        config: loaded,
        fetchImpl: changedFetch,
      }),
      /upstream content changed/,
    );
    assert.equal(fs.existsSync(vendored), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("volatile remote changes warn instead of failing", async () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendor:
  flaky:
    url: http://localhost:8080/flaky.js
    volatile: true
`,
  });
  const configPath = path.join(dir, "fx.yml");
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(SIGNALS),
    });
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "flaky",
      source: "http://localhost:8080/flaky.js",
      fetchImpl,
      volatile: true,
    });
    const loaded = loadConfigFrom(dir);
    assert.equal(loaded.vendor[0].volatile, true);

    fs.appendFileSync(
      path.join(dir, "extensions", "flaky.js"),
      "\n// local tweak\n",
    );
    const result = await loadVendorExtensions({
      configDir: dir,
      config: loaded,
      fetchImpl,
    });
    assert.ok(result.warnings.some((warning) => /volatile/.test(warning)));
    const verified = verifyVendor({ configDir: dir, config: loaded });
    assert.equal(verified.ok, true);
    assert.ok(verified.warnings.some((warning) => /volatile/.test(warning)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update shows a diff, dry-run writes nothing and outdated checks upstream", async () => {
  const dir = project();
  const configPath = path.join(dir, "fx.yml");
  let source = SIGNALS;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(source),
  });
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "signals",
      source: "https://example.test/signals.js",
      fetchImpl,
    });
    const loaded = loadConfigFrom(dir);
    const vendored = path.join(dir, "extensions", "signals.js");
    const original = fs.readFileSync(vendored);

    source = SIGNALS.replace("name: 'Signals'", "name: 'Signals v2'");
    const dry = await updateVendor({
      configDir: dir,
      config: loaded,
      fetchImpl,
      write: false,
    });
    assert.equal(dry.changed, 1);
    assert.match(dry.entries[0].diff, /\+.*Signals v2/);
    assert.deepEqual(fs.readFileSync(vendored), original);

    const updated = await updateVendor({
      configDir: dir,
      config: loaded,
      fetchImpl,
    });
    assert.equal(updated.changed, 1);
    assert.match(fs.readFileSync(vendored, "utf8"), /Signals v2/);
    assert.equal(
      readLock(dir).extensions.signals.sha256,
      sha256(fs.readFileSync(vendored)),
    );

    source = `${SIGNALS}\n// newer\n`;
    const outdated = await outdatedVendor({
      configDir: dir,
      config: loaded,
      fetchImpl,
    });
    assert.deepEqual(
      outdated.map((entry) => entry.status),
      ["outdated"],
    );
    assert.equal(verifyVendor({ configDir: dir, config: loaded }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("outdated sends conditional headers and honours 304 responses", async () => {
  const dir = project();
  const configPath = path.join(dir, "fx.yml");
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name) =>
          name.toLowerCase() === "etag"
            ? '"v1"'
            : name.toLowerCase() === "last-modified"
              ? "Wed, 01 Jan 2025 00:00:00 GMT"
              : null,
      },
      arrayBuffer: async () => Buffer.from(SIGNALS),
    });
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "signals",
      source: "https://example.test/signals.js",
      fetchImpl,
    });
    const lock = readLock(dir);
    assert.equal(lock.extensions.signals.etag, '"v1"');
    assert.equal(
      lock.extensions.signals.lastModified,
      "Wed, 01 Jan 2025 00:00:00 GMT",
    );

    let seen;
    const notModified = async (url, options) => {
      seen = options;
      return {
        ok: false,
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
      };
    };
    const results = await outdatedVendor({
      configDir: dir,
      config: loadConfigFrom(dir),
      fetchImpl: notModified,
    });
    assert.deepEqual(results, [
      { name: "signals", status: "current", file: "extensions/signals.js" },
    ]);
    assert.equal(seen.headers["If-None-Match"], '"v1"');
    assert.equal(
      seen.headers["If-Modified-Since"],
      "Wed, 01 Jan 2025 00:00:00 GMT",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveVendorFiles avoids file collisions for new entries", () => {
  const dir = tmp();
  try {
    const entries = [{ name: "a b" }, { name: "a/b" }, { name: "a-b" }];
    const files = resolveVendorFiles(
      dir,
      path.join(dir, "extensions"),
      entries,
      { extensions: {} },
    );
    assert.deepEqual(
      [...files.values()].map((entry) => entry.file),
      ["extensions/a-b.js", "extensions/a-b-2.js", "extensions/a-b-3.js"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("remove updates fx.yml, fx.lock and the vendored file", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const configPath = path.join(dir, "fx.yml");
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "local",
      source: "./local.js",
    });
    const loaded = loadConfigFrom(dir);
    const removed = removeVendoredExtension({
      configPath,
      configDir: dir,
      config: loaded,
      name: "local",
    });
    assert.equal(removed.file, "extensions/local.js");
    assert.equal(
      fs.existsSync(path.join(dir, "extensions", "local.js")),
      false,
    );
    assert.deepEqual(readLock(dir).extensions, {});
    assert.doesNotMatch(fs.readFileSync(configPath, "utf8"), /local/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("install restores every configured entry and reports missing local sources", async () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendor:
  one: https://example.test/one.js
  two: https://example.test/two.js
`,
  });
  const configPath = path.join(dir, "fx.yml");
  try {
    const fetchImpl = async (url) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(`${SIGNALS}\n// ${url}\n`),
    });
    const loaded = loadConfigFrom(dir);
    const result = await installVendor({
      configPath,
      configDir: dir,
      config: loaded,
      fetchImpl,
    });
    assert.deepEqual(
      result.entries.map((entry) => [entry.name, entry.status]),
      [
        ["one", "fetched"],
        ["two", "fetched"],
      ],
    );
    assert.ok(fs.existsSync(path.join(dir, "extensions", "one.js")));
    assert.ok(fs.existsSync(path.join(dir, "extensions", "two.js")));

    const again = await installVendor({
      configDir: dir,
      config: loadConfigFrom(dir),
      fetchImpl: () => {
        throw new Error("should not fetch existing files");
      },
    });
    assert.deepEqual(
      again.entries.map((entry) => entry.status),
      ["verified", "verified"],
    );

    const withLocal = project({
      config: `project:
  name: "Vendor"
vendor:
  missing: ./missing.js
`,
    });
    try {
      const localConfig = loadConfigFrom(withLocal);
      await assert.rejects(
        installVendor({
          configDir: withLocal,
          config: localConfig,
        }),
        /Could not read local extension/,
      );
    } finally {
      fs.rmSync(withLocal, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration backs up, names by extension id and preserves local/remote rules", async () => {
  const dir = project({
    config: `# legacy
project:
  name: "Migrate"
  extensions:
    - ./local.js
    - https://example.test/signals.js
  unsandboxed:
    - signals
`,
    extensions: { "local.js": SIGNALS },
  });
  const configPath = path.join(dir, "fx.yml");
  const original = fs.readFileSync(configPath, "utf8");
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(SIGNALS),
      text: async () => SIGNALS,
    });
    const loaded = loadConfigFrom(dir);
    const result = await migrateProjectExtensions({
      configPath,
      configDir: dir,
      config: loaded,
      fetchImpl,
    });

    assert.equal(fs.readFileSync(`${configPath}.bak`, "utf8"), original);
    assert.match(result.diff, /^- {2}extensions:/m);
    assert.match(result.diff, /^\+vendor:/m);
    assert.deepEqual(
      result.migrated.map((entry) => entry.name),
      ["signals", "signals-2"],
    );

    const updated = loadConfigFrom(dir);
    assert.deepEqual(updated.project.extensions, []);
    assert.deepEqual(
      updated.vendor.map((entry) => entry.name),
      ["signals", "signals-2"],
    );
    const local = updated.vendor.find((entry) => entry.name === "signals");
    assert.equal(local.local, true);
    assert.match(
      fs.readFileSync(path.join(dir, "extensions", "signals.js"), "utf8"),
      /^\/\/ generated from/,
    );

    const lock = readLock(dir);
    assert.equal(lock.extensions.signals.remote, false);
    assert.equal(lock.extensions.signals.local, true);
    assert.equal(lock.extensions["signals-2"].remote, true);
    assert.equal(lock.extensions["signals-2"].local, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration records unsandboxed extensions and aborts without partial output", async () => {
  const dir = project({
    config: `project:
  name: "Migrate"
  extensions:
    - ./unsandboxed.js
`,
    extensions: { "unsandboxed.js": UNSANDBOXED },
  });
  const configPath = path.join(dir, "fx.yml");
  try {
    const loaded = loadConfigFrom(dir);
    const result = await migrateProjectExtensions({
      configPath,
      configDir: dir,
      config: loaded,
    });
    assert.deepEqual(
      result.migrated.map((entry) => entry.name),
      ["demo"],
    );
    const updated = loadConfigFrom(dir);
    assert.equal(updated.vendor[0].unsandboxed, true);
    const loadedVendor = await loadVendorExtensions({
      configDir: dir,
      config: updated,
    });
    assert.deepEqual(loadedVendor.unsandboxed, ["demo"]);
    assert.deepEqual(
      loadedVendor.warnings.filter((warning) => /unsandboxed/.test(warning)),
      [],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const broken = project({
    config: `project:
  name: "Broken"
  extensions:
    - ./local.js
    - https://example.test/missing.js
`,
    extensions: { "local.js": SIGNALS },
  });
  const brokenConfig = path.join(broken, "fx.yml");
  const before = fs.readFileSync(brokenConfig, "utf8");
  try {
    await assert.rejects(
      migrateProjectExtensions({
        configPath: brokenConfig,
        configDir: broken,
        config: loadConfigFrom(broken),
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
        }),
      }),
      /fx\.yml was not changed/,
    );
    assert.equal(fs.readFileSync(brokenConfig, "utf8"), before);
    assert.equal(fs.existsSync(path.join(broken, "extensions")), false);
    assert.equal(fs.existsSync(path.join(broken, "fx.lock")), false);
    assert.equal(fs.existsSync(`${brokenConfig}.bak`), false);
  } finally {
    fs.rmSync(broken, { recursive: true, force: true });
  }
});

test("vendor CLI installs, lists, verifies and removes a local extension", () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  try {
    const installed = run(
      ["vendor", "install", "./local.js", "--as", "local"],
      dir,
    );
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(fs.readFileSync(path.join(dir, "fx.yml"), "utf8"), /local:/);

    const listed = run(["vendor", "list", "--json"], dir);
    assert.equal(listed.status, 0, listed.stderr);
    const json = JSON.parse(listed.stdout);
    assert.equal(json.vendorDir, "extensions");
    assert.equal(json.extensions.length, 1);
    assert.equal(json.extensions[0].name, "local");
    assert.equal(json.extensions[0].local, true);
    assert.equal(json.extensions[0].file, "extensions/local.js");

    const verified = run(["vendor", "verify"], dir);
    assert.equal(verified.status, 0, verified.stderr);

    const built = run(["b", "-o", "out.pmp", "--no-upgrade-prompt"], dir);
    assert.equal(built.status, 0, built.stderr);

    const removed = run(["vendor", "remove", "local"], dir);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(
      fs.existsSync(path.join(dir, "extensions", "local.js")),
      false,
    );
    assert.deepEqual(readLock(dir).extensions, {});
    assert.doesNotMatch(
      fs.readFileSync(path.join(dir, "fx.yml"), "utf8"),
      /local/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("vendor CLI honours a custom vendorDir", () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendorDir: deps/extensions
`,
    extensions: { "local.js": SIGNALS },
  });
  try {
    const installed = run(
      ["vendor", "install", "--unsandboxed", "./local.js", "--as", "local"],
      dir,
    );
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(fs.existsSync(path.join(dir, "deps", "extensions", "local.js")));
    assert.equal(
      fs.existsSync(path.join(dir, "extensions", "local.js")),
      false,
    );

    const listed = run(["vendor", "list", "--json"], dir);
    assert.equal(listed.status, 0, listed.stderr);
    const json = JSON.parse(listed.stdout);
    assert.equal(json.vendorDir, "deps/extensions");
    assert.equal(json.extensions[0].file, "deps/extensions/local.js");
    assert.equal(json.extensions[0].unsandboxed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("build auto-migrates legacy extensions with --yes and no TTY", () => {
  const dir = project({
    config: `project:
  name: "Auto"
  extensions:
    - ./local.js
`,
    extensions: { "local.js": SIGNALS },
  });
  try {
    const built = run(["b", "-o", "out.pmp", "--yes"], dir);
    assert.equal(built.status, 0, built.stderr);
    const config = fs.readFileSync(path.join(dir, "fx.yml"), "utf8");
    assert.doesNotMatch(config, /extensions:/);
    assert.match(config, /vendor:/);
    assert.ok(fs.existsSync(path.join(dir, "fx.yml.bak")));
    assert.ok(fs.existsSync(path.join(dir, "extensions", "signals.js")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dev does not retry a failed migration on rebuild", async () => {
  const dir = project({
    config: `project:
  name: "Auto"
  extensions:
    - ./missing.js
`,
  });
  const source = path.join(dir, "stage.tfx");
  fs.writeFileSync(source, "invalid source\n");
  const child = spawn(process.execPath, [bin, "dev", "--port", "0", "--yes"], {
    cwd: dir,
    env: { ...process.env, FX_NO_PROMPT: "0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = once(child, "exit");
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (errors += chunk));
  async function waitForBuilds(count) {
    const deadline = Date.now() + 10000;
    while ((errors.match(/Build failed:/g) || []).length < count) {
      if (child.exitCode !== null || Date.now() > deadline)
        throw new Error(`Timed out waiting for build ${count}: ${errors}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    await waitForBuilds(1);
    fs.writeFileSync(source, "another invalid source\n");
    await waitForBuilds(2);
    assert.equal(
      (errors.match(/Could not migrate project.extensions:/g) || []).length,
      1,
    );
  } finally {
    child.kill("SIGTERM");
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removing a vendor entry keeps following top-level keys", () => {
  const dir = tmp();
  const configPath = path.join(dir, "fx.yml");
  write(
    configPath,
    `project:
  name: "Demo"
vendor:
  signals: "https://example.test/signals.js"
vendorDir: deps/extensions
package:
  target: html
`,
  );
  try {
    removeVendorEntry(configPath, "signals");
    const text = fs.readFileSync(configPath, "utf8");
    assert.match(text, /vendor: \{\}/);
    assert.match(text, /vendorDir: deps\/extensions/);
    assert.match(text, /package:\n {2}target: html/);
    const parsed = parseConfig(text);
    assert.deepEqual(parsed.vendor, []);
    assert.equal(parsed.vendorDir, "deps/extensions");
    assert.equal(parsed.package.target, "html");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("builds install and verify reject a changed source", async () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendor:
  signals: https://example.test/signals.js
`,
  });
  const configPath = path.join(dir, "fx.yml");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(SIGNALS),
  });
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "signals",
      source: "https://example.test/signals.js",
      fetchImpl,
    });
    write(
      configPath,
      `project:
  name: "Vendor"
vendor:
  signals: https://mirror.test/signals.js
`,
    );
    const changed = loadConfigFrom(dir);
    await assert.rejects(
      loadVendorExtensions({
        configDir: dir,
        config: changed,
        fetchImpl: () => {
          throw new Error("should not fetch old bytes");
        },
      }),
      /source changed/,
    );
    await assert.rejects(
      installVendor({ configDir: dir, config: changed, fetchImpl }),
      /source changed/,
    );
    const verified = verifyVendor({ configDir: dir, config: changed });
    assert.equal(verified.ok, false);
    assert.match(verified.problems.join("\n"), /source changed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tightening volatile rejects the previously accepted change", async () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendor:
  flaky:
    url: https://example.test/flaky.js
    volatile: true
`,
  });
  const configPath = path.join(dir, "fx.yml");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(SIGNALS),
  });
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "flaky",
      source: "https://example.test/flaky.js",
      fetchImpl,
      volatile: true,
    });
    fs.appendFileSync(
      path.join(dir, "extensions", "flaky.js"),
      "\n// local tweak\n",
    );
    write(
      configPath,
      `project:
  name: "Vendor"
vendor:
  flaky: https://example.test/flaky.js
`,
    );
    const tightened = loadConfigFrom(dir);
    await assert.rejects(
      loadVendorExtensions({ configDir: dir, config: tightened, fetchImpl }),
      /does not match fx\.lock/,
    );
    assert.equal(verifyVendor({ configDir: dir, config: tightened }).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update refreshes a source-only lock change", async () => {
  const dir = project({
    config: `project:
  name: "Vendor"
vendor:
  signals: https://example.test/signals.js
`,
  });
  const configPath = path.join(dir, "fx.yml");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(SIGNALS),
  });
  const vendored = path.join(dir, "extensions", "signals.js");
  try {
    await installVendorEntry({
      configPath,
      configDir: dir,
      name: "signals",
      source: "https://example.test/signals.js",
      fetchImpl,
    });
    const original = fs.readFileSync(vendored);
    write(
      configPath,
      `project:
  name: "Vendor"
vendor:
  signals: https://mirror.test/signals.js
`,
    );
    const changed = loadConfigFrom(dir);
    const result = await updateVendor({
      configDir: dir,
      config: changed,
      fetchImpl,
    });
    assert.equal(result.changed, 0);
    assert.equal(result.entries[0].sourceChanged, true);
    assert.equal(
      readLock(dir).extensions.signals.source,
      "https://mirror.test/signals.js",
    );
    assert.deepEqual(fs.readFileSync(vendored), original);
    assert.equal(verifyVendor({ configDir: dir, config: changed }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration locks raw remote bytes for BOM restores", async () => {
  const dir = project({
    config: `project:
  name: "Migrate"
  extensions:
    - https://example.test/signals.js
`,
  });
  const configPath = path.join(dir, "fx.yml");
  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(SIGNALS),
  ]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    arrayBuffer: async () => bom,
  });
  const vendored = path.join(dir, "extensions", "signals.js");
  try {
    await migrateProjectExtensions({
      configPath,
      configDir: dir,
      config: loadConfigFrom(dir),
      fetchImpl,
    });
    assert.equal(readLock(dir).extensions.signals.sha256, sha256(bom));
    assert.deepEqual(fs.readFileSync(vendored), bom);

    fs.rmSync(vendored);
    await loadVendorExtensions({
      configDir: dir,
      config: loadConfigFrom(dir),
      fetchImpl,
    });
    assert.deepEqual(fs.readFileSync(vendored), bom);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to write or read through a symlinked vendor directory", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const outside = tmp();
  fs.symlinkSync(outside, path.join(dir, "extensions"), "dir");
  try {
    await assert.rejects(
      installVendorEntry({
        configPath: path.join(dir, "fx.yml"),
        configDir: dir,
        name: "local",
        source: "./local.js",
      }),
      /symbolic link/,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects vendor roots outside or equal to the project directory", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const configPath = path.join(dir, "fx.yml");
  const original = fs.readFileSync(configPath, "utf8");
  try {
    for (const vendorDir of [".", "..", `${dir}-sibling`, path.dirname(dir)]) {
      await assert.rejects(
        installVendorEntry({
          configPath,
          configDir: dir,
          name: "local",
          source: "./local.js",
          vendorDir,
        }),
        /vendor directory .* must be inside the project directory/,
      );
    }
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.equal(fs.existsSync(path.join(dir, "fx.lock")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects symlinked ancestors in vendor roots starting with two dots", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const outside = tmp();
  fs.symlinkSync(outside, path.join(dir, "..deps"), "dir");
  try {
    await assert.rejects(
      installVendorEntry({
        configPath: path.join(dir, "fx.yml"),
        configDir: dir,
        name: "local",
        source: "./local.js",
        vendorDir: "..deps/extensions",
      }),
      /symbolic link/,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("keeps locked targets inside a valid vendor root", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  try {
    for (const file of ["../escaped.js", "other.js"]) {
      await assert.rejects(
        installVendorEntry({
          configPath: path.join(dir, "fx.yml"),
          configDir: dir,
          name: "local",
          source: "./local.js",
          lock: { extensions: { local: { file } } },
        }),
        /outside extensions/,
      );
    }
    const installed = await installVendorEntry({
      configPath: path.join(dir, "fx.yml"),
      configDir: dir,
      name: "local",
      source: "./local.js",
      vendorDir: "..deps/extensions",
    });
    assert.equal(installed.file, "..deps/extensions/local.js");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not overwrite an untracked vendor file", async () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  const vendorFile = path.join(dir, "extensions", "local.js");
  write(vendorFile, "// keep me\n");
  try {
    const result = await installVendorEntry({
      configPath: path.join(dir, "fx.yml"),
      configDir: dir,
      name: "local",
      source: "./local.js",
    });
    assert.equal(result.file, "extensions/local-2.js");
    assert.equal(fs.readFileSync(vendorFile, "utf8"), "// keep me\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reinstall preserves an existing unsandboxed flag", () => {
  const dir = project({ extensions: { "local.js": SIGNALS } });
  try {
    const first = run(
      ["vendor", "install", "--unsandboxed", "./local.js", "--as", "local"],
      dir,
    );
    assert.equal(first.status, 0, first.stderr);
    const second = run(
      ["vendor", "install", "./local.js", "--as", "local"],
      dir,
    );
    assert.equal(second.status, 0, second.stderr);
    assert.match(
      fs.readFileSync(path.join(dir, "fx.yml"), "utf8"),
      /unsandboxed: true/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("combined loaders do not flag the other loader's unsandboxed ids", () => {
  const dir = project({
    config: `project:
  name: "Vendor"
  extensions:
    - ./local.js
  unsandboxed:
    - demo
vendor:
  demo: ./unsandboxed.js
`,
    extensions: { "local.js": SIGNALS, "unsandboxed.js": UNSANDBOXED },
  });
  try {
    const result = run(["catalog", "--no-upgrade-prompt"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /does not match any loaded extension/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
