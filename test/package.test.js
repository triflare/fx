import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { normalizePackage, parseConfig } from "../src/config.js";
import {
  applyCustomHtml,
  extractArchive,
  packageExtension,
  packageOutputPath,
  resolvePackageConfig,
  slugify,
} from "../src/package.js";
import { packageProject, packagerDistPath } from "../src/packager.js";
import { unzipSync } from "../src/sb3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hasPackager = fs.existsSync(path.join(packagerDistPath(), "packager.js"));

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-package-"));
}

test("resolvePackageConfig resolves file-backed overrides relative to fx.yml", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "custom.css"), "body { color: red; }");
    fs.writeFileSync(path.join(dir, "custom.html"), "<div>hello</div>");
    const { package: pkg } = parseConfig(`
package:
  target: windows
  output: dist/game.zip
  icon: assets/icon.png
  name: "My Game"
  custom:
    js: "console.log('inline')"
    css:
      file: custom.css
    html:
      file: custom.html
`);
    const resolved = resolvePackageConfig(pkg, {
      baseDir: dir,
      projectName: "Fallback",
    });
    assert.equal(resolved.target, "electron-win64");
    assert.equal(resolved.output, path.join(dir, "dist", "game.zip"));
    assert.equal(resolved.icon, path.join(dir, "assets", "icon.png"));
    assert.equal(resolved.name, "My Game");
    assert.equal(resolved.custom.js, "console.log('inline')");
    assert.equal(resolved.custom.css, "body { color: red; }");
    assert.equal(resolved.custom.html, "<div>hello</div>");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("package output paths and extensions follow the target", () => {
  assert.equal(packageExtension("html"), ".html");
  assert.equal(packageExtension("windows"), ".zip");
  assert.equal(slugify("My Cool Game!"), "my-cool-game");
  const dir = tmp();
  try {
    assert.equal(
      packageOutputPath({ target: "html", name: "My Game", dir }),
      path.join(dir, "build", "my-game.html"),
    );
    assert.equal(
      packageOutputPath({
        target: "windows",
        name: "My Game",
        output: path.join(dir, "dist", "game"),
        dir,
      }),
      path.join(dir, "dist", "game.zip"),
    );
    fs.mkdirSync(path.join(dir, "out"));
    assert.equal(
      packageOutputPath({
        target: "html",
        name: "My Game",
        output: path.join(dir, "out"),
        dir,
      }),
      path.join(dir, "out", "my-game.html"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("custom HTML is injected before the closing body tag", () => {
  assert.equal(
    applyCustomHtml("<html><body><h1>Hi</h1></body></html>", "<div>x</div>"),
    "<html><body><h1>Hi</h1><!-- fx: custom html -->\n<div>x</div>\n</body></html>",
  );
  assert.equal(
    applyCustomHtml("fragment", "<b>x</b>"),
    "fragment\n<!-- fx: custom html -->\n<b>x</b>\n",
  );
  assert.equal(applyCustomHtml("<body>x</body>", ""), "<body>x</body>");
});

test("extractArchive writes files and refuses path traversal", async () => {
  const { default: JSZip } = await import("jszip");
  const dir = tmp();
  try {
    const zip = new JSZip();
    zip.file("game.txt", "hello");
    zip.file("bin/game", "#!/bin/sh\n", { unixPermissions: 0o755 });
    const data = await zip.generateAsync({
      type: "nodebuffer",
      platform: "UNIX",
    });
    const written = await extractArchive(data, dir);
    assert.deepEqual(written.sort(), ["bin/game", "game.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "game.txt"), "utf8"), "hello");
    if (process.platform !== "win32")
      assert.ok(fs.statSync(path.join(dir, "bin", "game")).mode & 0o100);

    const unsafe = new JSZip();
    unsafe.file("../outside.txt", "nope");
    const unsafeData = await unsafe.generateAsync({ type: "nodebuffer" });
    await assert.rejects(() => extractArchive(unsafeData, dir), /unsafe path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "packages HTML with inline and file-backed custom overrides",
  { skip: !hasPackager && "run `npm run build:packager` first" },
  async () => {
    const dir = tmp();
    try {
      fs.writeFileSync(
        path.join(dir, "custom.css"),
        "#from-file { color: red; }",
      );
      fs.writeFileSync(
        path.join(dir, "custom.html"),
        '<div id="from-file">FILE HTML</div>',
      );
      const { package: pkg } = parseConfig(`
project:
  name: "Pack Test"
package:
  name: "Pack Test"
  custom:
    js: "console.log('INLINE_JS')"
    css:
      file: custom.css
    html:
      file: custom.html
`);
      const { sb3 } = build({ dir: path.join(root, "examples", "player") });
      const config = resolvePackageConfig(pkg, {
        baseDir: dir,
        projectName: "Pack Test",
      });
      const result = await packageProject({
        sb3,
        projectName: "Pack Test",
        packageConfig: config,
      });

      assert.equal(result.type, "text/html");
      assert.equal(result.target, "html");
      const html = result.data.toString("utf8");
      assert.match(html, /<title>Pack Test<\/title>/);
      assert.match(html, /console\.log\('INLINE_JS'\)/);
      assert.match(html, /#from-file \{ color: red; \}/);
      assert.match(html, /id="from-file">FILE HTML/);
      assert.ok(html.indexOf("FILE HTML") < html.lastIndexOf("</body>"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "applies custom HTML inside zip and desktop archives",
  { skip: !hasPackager && "run `npm run build:packager` first" },
  async () => {
    const { sb3 } = build({ dir: path.join(root, "examples", "player") });
    const pkg = normalizePackage({
      target: "zip",
      name: "Archive Test",
      custom: { html: "<div>ZIP HTML</div>" },
    });
    const result = await packageProject({
      sb3,
      projectName: "Archive Test",
      packageConfig: resolvePackageConfig(pkg, { baseDir: root }),
    });
    assert.equal(result.type, "application/zip");
    const files = unzipSync(result.data);
    const index = files.get("index.html");
    assert.ok(index, "archive should contain index.html");
    const html = index.toString("utf8");
    assert.match(html, /<title>Archive Test<\/title>/);
    assert.match(html, /ZIP HTML/);
  },
);
