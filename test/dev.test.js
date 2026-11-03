import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectDevClient, startDevServer } from "../src/dev.js";

const silent = { error() {}, success() {}, warn() {}, info() {} };

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-dev-"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeout = 8000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(interval);
  }
  throw new Error("Timed out waiting for condition");
}

function openEvents(url) {
  const controller = new AbortController();
  let text = "";
  const ready = (async () => {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    }
  })();
  return {
    ready,
    text: () => text,
    close() {
      controller.abort();
    },
  };
}

test("dev server reloads only when the built HTML changes", async () => {
  const dir = tmp();
  const file = path.join(dir, "main.tfx");
  fs.writeFileSync(file, "one");
  let fail = false;

  const server = await startDevServer({
    watchDir: dir,
    port: 0,
    debounce: 20,
    log: silent,
    build: async () => {
      if (fail) throw new Error("boom");
      return `<!doctype html><html><body><h1>${fs.readFileSync(
        file,
        "utf8",
      )}</h1></body></html>`;
    },
  });
  const events = openEvents(new URL("/__fx/events", server.url).href);

  try {
    await server.ready;
    const first = await (await fetch(server.url)).text();
    assert.match(first, /<h1>one<\/h1>/);
    assert.match(first, /data-fx-dev/);
    assert.match(first, /__fx\/events/);

    await waitFor(() => events.text().includes("event: connected"));

    // A file event that produces identical HTML must not reload the browser.
    fs.writeFileSync(file, "one");
    await delay(250);
    assert.doesNotMatch(events.text(), /event: reload/);

    // Different output does reload.
    fs.writeFileSync(file, "two");
    await waitFor(() => events.text().includes("event: reload"));
    assert.match(await (await fetch(server.url)).text(), /<h1>two<\/h1>/);

    // Build errors keep the last good HTML and are broadcast over SSE.
    fail = true;
    fs.writeFileSync(file, "three");
    await waitFor(() => events.text().includes("event: build-error"));
    const duringError = await (await fetch(server.url)).text();
    assert.match(duringError, /<h1>two<\/h1>/);
    const status = await (
      await fetch(new URL("/__fx/status", server.url))
    ).json();
    assert.equal(status.ok, false);
    assert.match(status.error, /boom/);

    // Recovering reloads, even if the serving page had the same bytes.
    fail = false;
    fs.writeFileSync(file, "four");
    await waitFor(
      () => (events.text().match(/event: reload/g) || []).length >= 2,
    );
    assert.match(await (await fetch(server.url)).text(), /<h1>four<\/h1>/);
    const recovered = await (
      await fetch(new URL("/__fx/status", server.url))
    ).json();
    assert.equal(recovered.ok, true);
  } finally {
    events.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dev client is injected before the last closing body tag", () => {
  // Packaged pages inline a bundle whose strings can contain "</body>".
  const html =
    '<html><body>\n<script>const tpl = "</body>";</script>\n<h1>hi</h1>\n</body>\n</html>';
  const out = injectDevClient(html);
  assert.ok(out.indexOf("data-fx-dev") > out.indexOf("<h1>hi</h1>"));
  assert.ok(out.indexOf("data-fx-dev") < out.lastIndexOf("</body>"));
  assert.ok(out.includes('<script>const tpl = "</body>";</script>'));
  assert.equal(out.match(/<\/body>/g).length, 2);
  assert.ok(out.trimEnd().endsWith("</html>"));
  assert.equal(injectDevClient(out), out);
});

test("dev client ignores </body> in comments and trailing scripts", () => {
  const html =
    "<html><body><h1>hi</h1></body><!-- </body> -->\n" +
    '<script>const tpl = "</body>";</script></html>';
  const out = injectDevClient(html);
  assert.ok(out.indexOf("data-fx-dev") < out.indexOf("</body>"));
  assert.ok(out.includes("</body><!-- </body> -->"));
  assert.ok(out.includes('<script>const tpl = "</body>";</script>'));
});

test("dev client ignores </body> in iframe fallback content", () => {
  const html =
    "<html><body><h1>hi</h1><iframe>fallback </body> text</iframe></body></html>";
  const out = injectDevClient(html);
  assert.ok(out.indexOf("data-fx-dev") > out.indexOf("</iframe>"));
  assert.ok(out.indexOf("data-fx-dev") < out.lastIndexOf("</body>"));
});

test("dev client is not injected into plaintext content", () => {
  // `<plaintext>` swallows the rest of the document, so no later tag is markup.
  const html = "<html><body><h1>hi</h1><plaintext>raw </body> text";
  const out = injectDevClient(html);
  assert.ok(out.indexOf("data-fx-dev") < out.indexOf("<plaintext>"));
  assert.ok(out.includes("<plaintext>raw </body> text"));
});

test("dev client ignores </body> inside quoted iframe attributes", () => {
  // The start tag ends after the quoted `srcdoc`, not at the `>` inside it, and
  // the missing `</iframe>` means the rest of the document is text.
  const html = '<html><body><iframe srcdoc="</iframe></body>">fallback';
  const out = injectDevClient(html);
  assert.ok(out.indexOf("data-fx-dev") < out.indexOf("<iframe"));
  assert.ok(out.includes('<iframe srcdoc="</iframe></body>">fallback'));
});

test("dev server picks the next free port unless strict", async () => {
  const dir = tmp();
  const first = await startDevServer({
    watchDir: dir,
    port: 0,
    log: silent,
    build: async () => "<html><body>one</body></html>",
  });
  let second;
  try {
    await first.ready;
    second = await startDevServer({
      watchDir: dir,
      port: first.port,
      log: silent,
      build: async () => "<html><body>two</body></html>",
    });
    await second.ready;
    assert.notEqual(second.port, first.port);
    assert.match(await (await fetch(second.url)).text(), /two/);

    await assert.rejects(
      () =>
        startDevServer({
          watchDir: dir,
          port: first.port,
          strictPort: true,
          log: silent,
          build: async () => "<html><body>three</body></html>",
        }),
      /EADDRINUSE/,
    );
  } finally {
    await second?.close();
    await first.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
