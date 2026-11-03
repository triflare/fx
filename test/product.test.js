import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadProduct } from "../src/product.js";
import { brandingColors, brandText } from "../src/brand.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

const plainStream = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });

test("product.yml carries the identity, symbols and defaults", () => {
  const product = loadProduct();
  assert.equal(product.name, "Triflare Fx");
  assert.equal(product.command, "fx");
  assert.equal(product.symbols.success, "✓");
  assert.equal(product.symbols.error, "✗");
  assert.equal(product.symbols.bullet, "•");
  assert.equal(product.defaults.configFilename, "fx.yml");
  assert.equal(product.defaults.sourceExtension, ".tfx");
  assert.equal(product.defaults.outputDirectory, "build");
});

test("brandingColors reads the palette from product.yml", () => {
  const colors = brandingColors();
  for (const key of ["primary", "secondary", "tertiary"])
    assert.match(colors[key], /^#[0-9a-f]{6}$/i, `${key} is not a hex color`);
  assert.deepEqual(colors, loadProduct().branding.colors);
});

test("product.yml version matches package.json", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(loadProduct().version, pkg.version);
});

function truecolor(hex) {
  const [red, green, blue] = hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16));
  return `\x1b[38;2;${red};${green};${blue}m`;
}

test("brandText paints text with each brand color", () => {
  const previous = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    const colors = brandingColors();
    const text = brandText("Triflare Fx");
    for (const color of [colors.primary, colors.secondary, colors.tertiary])
      assert.ok(text.includes(truecolor(color)));
  } finally {
    if (previous === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previous;
  }
});

test("brandText stays plain when the stream can't show color", () => {
  // node --test sets FORCE_COLOR when its own output is colorized, and
  // styleText honors it over the stream.
  const previous = process.env.FORCE_COLOR;
  delete process.env.FORCE_COLOR;
  try {
    assert.equal(brandText("Triflare Fx", plainStream()), "Triflare Fx");
  } finally {
    if (previous !== undefined) process.env.FORCE_COLOR = previous;
  }
});

test("init uses the filenames and extension from product.yml", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fx-product-"));
  try {
    const result = spawnSync(process.execPath, [bin, "init"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, "fx.yml")));
    assert.ok(fs.existsSync(path.join(dir, "src", "main.tfx")));
    assert.match(
      fs.readFileSync(path.join(dir, "fx.yml"), "utf8"),
      /My Triflare Fx Project/,
    );
    assert.match(
      fs.readFileSync(path.join(dir, "fx.yml"), "utf8"),
      /^fx:\n {2}partialSprites: false$/m,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
