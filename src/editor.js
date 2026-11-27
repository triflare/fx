/**
 * Local project server for `fx open`.
 *
 * PenguinMod can load a project straight from a URL (`?project_url=`), but the
 * editor fetches that URL from its own origin, so the server has to answer with
 * CORS headers — including the private-network preflight Chrome sends when a
 * public page reaches for a loopback address.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { formatDevUrls } from "./dev.js";

/** Editor page that accepts a `project_url` query parameter. */
export const PENGUINMOD_EDITOR = "https://studio.penguinmod.com/editor.html";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  // Chrome asks before a public page may read a loopback address.
  "Access-Control-Allow-Private-Network": "true",
};

/**
 * Editor link that loads `projectUrl` directly into the editor.
 * @param {string} projectUrl
 * @param {string} [base]
 * @returns {string}
 */
export function editorUrl(projectUrl, base = PENGUINMOD_EDITOR) {
  const url = new URL(base);
  url.searchParams.set("project_url", projectUrl);
  return url.href;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function indexPage({ filename, link }) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(filename)}</title></head>
<body style="margin:0;padding:24px;background:#0e0e12;color:#ddd;font:14px/1.5 ui-monospace,monospace">
<p>${escapeHtml(filename)} is served at <a style="color:#3cc6ab" href="/${escapeHtml(filename)}">/${escapeHtml(filename)}</a>.</p>
<p><a style="color:#3cc6ab" href="${escapeHtml(link)}">Open it in the PenguinMod editor</a></p>
</body>
</html>`;
}

/**
 * Serve one project archive over HTTP until closed.
 *
 * @param {object} options
 * @param {Buffer|Uint8Array} options.data Archive bytes.
 * @param {string} options.filename Name the archive is served under.
 * @param {string} [options.host="127.0.0.1"]
 * @param {number} [options.port=3000] Port 0 asks the OS for a free port.
 * @param {boolean} [options.strictPort=false]
 * @param {string} [options.editorBase] Editor page to link to.
 * @param {object} [options.log]
 * @returns {Promise<object>}
 */
export async function startEditorServer(options = {}) {
  if (!options.data) throw new Error("startEditorServer requires project data");
  if (!options.filename)
    throw new Error("startEditorServer requires a filename");

  const data = Buffer.from(options.data);
  const filename = String(options.filename);
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
  const log = options.log || {};

  let closed = false;
  let currentUrl = null;
  const projectPath = `/${encodeURIComponent(filename)}`;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    // Preflight, including Chrome's private-network request.
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        ...CORS_HEADERS,
        Allow: "GET, HEAD, OPTIONS",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Method not allowed\n");
      return;
    }

    const head = request.method === "HEAD";

    if (url.pathname === projectPath) {
      response.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
      response.end(head ? undefined : data);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        head
          ? undefined
          : indexPage({
              filename,
              link: editorUrl(currentUrl || projectPath, options.editorBase),
            }),
      );
      return;
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    response.writeHead(404, {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(head ? undefined : `Not found: ${filename}\n`);
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

  const urls = formatDevUrls({ host, port });
  const projectUrls = [...urls.local, ...urls.network].map(
    (base) => `${base}${filename}`,
  );
  const editorUrls = projectUrls.map((projectUrl) =>
    editorUrl(projectUrl, options.editorBase),
  );
  currentUrl = projectUrls[0];

  return {
    server,
    host,
    port,
    data,
    filename,
    projectUrl: projectUrls[0],
    projectUrls,
    editorUrl: editorUrls[0],
    editorUrls,
    localUrls: urls.local,
    networkUrls: urls.network,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
    },
  };
}

/**
 * Open `url` in the platform browser. Resolves false when no opener is
 * available, which is the normal case on servers and in containers.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function openBrowser(url) {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  return new Promise((resolve) => {
    let settled = false;
    const done = (opened) => {
      if (settled) return;
      settled = true;
      resolve(opened);
    };
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.once("error", () => done(false));
      child.once("spawn", () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}
