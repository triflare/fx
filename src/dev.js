/**
 * Development server for `fx dev`.
 *
 * The server builds through a caller-provided callback, compares the finished
 * HTML with the previous result, and only tells connected browsers to reload
 * when the bytes actually changed. Build errors keep the last good page and
 * are reported over Server-Sent Events.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "coverage",
  ".cache",
  ".smoke",
  ".vscode",
  ".vscode-test",
  ".vscode-test-web",
  "vendor",
  "reference",
]);

const DEV_EVENTS_PATH = "/__fx/events";
const DEV_STATUS_PATH = "/__fx/status";

function isWildcardHost(host) {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function urlHost(host) {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

function ignoredFile(filename) {
  if (!filename) return false;
  return filename.split(/[\\/]/).some((segment) => {
    if (!segment) return false;
    if (IGNORED_SEGMENTS.has(segment)) return true;
    return segment.startsWith(".") && segment !== ".";
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Elements whose content the HTML tokenizer treats as text rather than markup.
 * `noscript` is included because this page always runs scripts, which is
 * exactly when the parser stops tokenizing its content.
 */
const RAW_TEXT_TAGS = new Set([
  "script",
  "style",
  "title",
  "textarea",
  "iframe",
  "noembed",
  "noframes",
  "xmp",
  "noscript",
]);

const TAG_NAME_AT = /<([a-zA-Z][^\s/>]*)/y;

/**
 * Index just past the start tag beginning at `start`, skipping quoted attribute
 * values so a `>` inside `srcdoc="…"` cannot end the tag early. Returns -1 when
 * the tag never closes.
 * @param {string} html
 * @param {number} start
 * @returns {number}
 */
function startTagEnd(html, start) {
  let quote = "";
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Index just past the first `</name>` at or after `from`, or -1.
 * @param {string} html
 * @param {string} name
 * @param {number} from
 * @returns {number}
 */
function endTagEnd(html, name, from) {
  const pattern = new RegExp(`</${name}\\s*>`, "gi");
  pattern.lastIndex = from;
  const match = pattern.exec(html);
  return match ? match.index + match[0].length : -1;
} /**
 * Find the ranges the HTML tokenizer treats as text rather than markup, so tag
 * searches cannot match text that merely looks like markup (a `</body>` inside
 * a script string, a commented-out tag, an attribute value, ...).
 * @param {string} html
 * @returns {{ranges: Array<[number, number]>, textFrom: number}} `ranges` are
 *   sorted, non-overlapping `[start, end)` spans; `textFrom` is the offset
 *   where a `<plaintext>` or unterminated tag/text element starts, so nothing
 *   from there to end of input is markup. -1 when the whole input is markup.
 */
function nonMarkupRanges(html) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let textFrom = -1;
  let i = 0;

  while (i < html.length) {
    const tag = html.indexOf("<", i);
    if (tag === -1) break;

    if (html.startsWith("<!--", tag)) {
      const close = html.indexOf("-->", tag + 4);
      const end = close === -1 ? html.length : close + 3;
      ranges.push([tag, end]);
      i = end;
      continue;
    }

    TAG_NAME_AT.lastIndex = tag;
    const match = TAG_NAME_AT.exec(html);
    const start = startTagEnd(html, tag);
    const name = match ? match[1].toLowerCase() : "";

    // An unterminated tag, and `<plaintext>`, make the rest of the input text.
    if (start === -1 || name === "plaintext") {
      ranges.push([tag, html.length]);
      textFrom = tag;
      break;
    }

    if (!RAW_TEXT_TAGS.has(name)) {
      i = start;
      continue;
    }

    // A text element without its end tag also runs to end of input.
    const close = endTagEnd(html, name, start);
    if (close === -1) {
      ranges.push([tag, html.length]);
      textFrom = tag;
      break;
    }

    ranges.push([tag, close]);
    i = close;
  }

  return { ranges, textFrom };
}

/**
 * Offset of the last `</body>` outside the given text ranges, or -1.
 * @param {string} html
 * @param {Array<[number, number]>} ranges
 * @returns {number}
 */
function lastBodyEnd(html, ranges) {
  let bodyEnd = -1;
  let next = 0;
  for (const match of html.matchAll(/<\/body\s*>/gi)) {
    while (next < ranges.length && ranges[next][1] <= match.index) next += 1;
    const range = ranges[next];
    if (range && range[0] <= match.index) continue; // text, not a tag
    bodyEnd = match.index;
  }
  return bodyEnd;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function injectDevClient(html) {
  if (html.includes("data-fx-dev")) return html;
  const script = `<script data-fx-dev>
(() => {
  if (window.__fxDevClient) return;
  window.__fxDevClient = true;
  let banner = null;
  const showError = (message) => {
    if (!banner) {
      banner = document.createElement("pre");
      banner.id = "__fx_dev_error";
      banner.style.cssText = "position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;margin:0;padding:12px;background:#210b0b;color:#ffb4b4;border-top:1px solid #ff6b6b;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;z-index:2147483647";
      document.body.appendChild(banner);
    }
    banner.textContent = "Build failed\\n\\n" + message;
  };
  const source = new EventSource(${JSON.stringify(DEV_EVENTS_PATH)});
  source.addEventListener("reload", () => location.reload());
  source.addEventListener("build-error", (event) => showError(event.data));
  source.addEventListener("connected", () => {
    if (banner) banner.remove();
    banner = null;
  });
})();
</script>`;
  // Insert before the *last* real closing body tag: packaged pages inline a
  // bundle that can itself contain the literal text `</body>` inside a string,
  // and injecting there would corrupt the script instead of ending the
  // document. Comments, text-element content and attribute values are masked
  // first so a quoted or commented-out `</body>` cannot capture the injection.
  const { ranges, textFrom } = nonMarkupRanges(html);
  const bodyEnd = lastBodyEnd(html, ranges);

  // Without a usable body end tag, go before the point where the document
  // turns into text (keeping the client a script rather than literal text),
  // or append when the whole input was markup.
  const at =
    bodyEnd === -1 ? (textFrom === -1 ? html.length : textFrom) : bodyEnd;
  const before = html.slice(0, at);
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  return `${before}${separator}${script}${html.slice(at)}`;
}

/**
 * URLs to print for a listening dev server.
 * @param {{host: string, port: number}} options
 * @returns {{local: string[], network: string[]}}
 */
export function formatDevUrls({ host, port }) {
  if (!isWildcardHost(host)) {
    return {
      local: [`http://${urlHost(host)}:${port}/`],
      network: [],
    };
  }

  const local = [`http://localhost:${port}/`];
  const network = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.internal || address.family !== "IPv4") continue;
      network.push(`http://${address.address}:${port}/`);
    }
  }
  return { local, network: [...new Set(network)] };
}

function normalizeHtml(result) {
  if (typeof result === "string") return result;
  if (Buffer.isBuffer(result) || result instanceof Uint8Array)
    return Buffer.from(result).toString("utf8");
  if (result && typeof result.html === "string") return result.html;
  throw new Error("fx dev build callback must return HTML text");
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  for (const line of String(data).split("\n"))
    response.write(`data: ${line}\n`);
  response.write("\n");
}

function errorPage(error) {
  const message = error?.stack || error?.message || "Unknown build error";
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Build failed</title></head>
<body style="margin:0;padding:24px;background:#160d0d;color:#ffb4b4;font:14px/1.5 ui-monospace,monospace">
<h1 style="font-size:18px">Build failed</h1>
<pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>
</body>
</html>`;
}

function loadingPage() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Building…</title></head>
<body style="margin:0;padding:24px;background:#0e0e12;color:#ddd;font:14px/1.5 ui-monospace,monospace">
Building…
</body>
</html>`;
}

/**
 * Start the dev server and watch a directory for changes.
 *
 * @param {object} options
 * @param {string} options.watchDir Directory to watch recursively.
 * @param {() => Promise<string|Buffer|{html: string}>} options.build Build callback.
 * @param {string} [options.host="127.0.0.1"]
 * @param {number} [options.port=3000] Port 0 asks the OS for a free port.
 * @param {boolean} [options.strictPort=false]
 * @param {number} [options.debounce=75]
 * @param {object} [options.log] Logger with error/success/warn/info methods.
 * @returns {Promise<object>}
 */
export async function startDevServer(options = {}) {
  const watchDir = path.resolve(options.watchDir || process.cwd());
  if (!fs.existsSync(watchDir))
    throw new Error(`Watch directory does not exist: ${watchDir}`);
  if (typeof options.build !== "function")
    throw new Error("startDevServer requires a build callback");

  const host =
    options.host === true || options.host == null
      ? "127.0.0.1"
      : String(options.host);
  const requestedPort = options.port == null ? 3000 : Number(options.port);
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65535
  )
    throw new Error(`Invalid port: ${options.port}`);
  const strictPort = Boolean(options.strictPort);
  const debounce = options.debounce ?? 75;
  const log = options.log || {};
  const clients = new Set();

  let currentHtml = null;
  let currentError = null;
  let previousHtml = null;
  let hasBuilt = false;
  let closed = false;
  let building = false;
  let queued = false;
  let timer = null;
  let watcher = null;

  function broadcast(event, data) {
    for (const client of clients) {
      try {
        writeEvent(client, event, data);
      } catch {
        clients.delete(client);
      }
    }
  }

  async function runBuild() {
    if (closed) return;
    if (building) {
      queued = true;
      return;
    }
    building = true;
    const recovering = currentError != null;
    try {
      const html = normalizeHtml(await options.build());
      const changed = html !== previousHtml;
      previousHtml = html;
      currentHtml = html;
      if (currentError) currentError = null;
      if (changed || recovering) {
        broadcast("reload", String(Date.now()));
        if (hasBuilt) log.success?.("Reloaded browser");
        hasBuilt = true;
      }
    } catch (err) {
      currentError = err instanceof Error ? err : new Error(String(err));
      log.error?.(`Build failed: ${currentError.message}`);
      broadcast("build-error", currentError.stack || currentError.message);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        schedule(0);
      }
    }
  }

  function schedule(delay = debounce) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runBuild();
    }, delay);
    timer.unref?.();
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    if (url.pathname === DEV_EVENTS_PATH) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 500\n\n");
      writeEvent(response, "connected", String(Date.now()));
      clients.add(response);
      response.on("close", () => clients.delete(response));
      return;
    }

    if (url.pathname === DEV_STATUS_PATH) {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        `${JSON.stringify({
          ok: !currentError,
          error: currentError ? currentError.message : null,
          html: currentHtml != null,
        })}\n`,
      );
      return;
    }

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    const html =
      currentHtml ?? (currentError ? errorPage(currentError) : loadingPage());
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(injectDevClient(html));
  });

  let port;
  for (let attempt = 0; ; attempt += 1) {
    try {
      port = await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve(server.address().port);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(requestedPort === 0 ? 0 : requestedPort + attempt, host);
      });
      break;
    } catch (error) {
      if (
        error.code !== "EADDRINUSE" ||
        strictPort ||
        requestedPort === 0 ||
        attempt >= 20
      )
        throw error;
      log.warn?.(
        `Port ${requestedPort + attempt} is in use, trying ${
          requestedPort + attempt + 1
        }…`,
      );
    }
  }

  try {
    watcher = fs.watch(watchDir, { recursive: true }, (_event, filename) => {
      if (!ignoredFile(filename)) schedule();
    });
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error(
      `Could not watch ${watchDir}: ${error.message}. ` +
        "Recursive file watching needs Node.js 22 or newer.",
      { cause: error },
    );
  }

  const keepAlive = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(": ping\n\n");
      } catch {
        clients.delete(client);
      }
    }
  }, 25000);
  keepAlive.unref();

  const ready = runBuild();
  const urls = formatDevUrls({ host, port });

  return {
    server,
    host,
    port,
    url: urls.local[0],
    localUrls: urls.local,
    networkUrls: urls.network,
    ready,
    get html() {
      return currentHtml;
    },
    get error() {
      return currentError;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearInterval(keepAlive);
      watcher?.close();
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // already closed
        }
      }
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
    },
  };
}
