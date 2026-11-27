import path from "node:path";
import { build } from "../../build.js";
import { sourceExtension } from "../../brand.js";
import { openBrowser, startEditorServer } from "../../editor.js";
import { slugify } from "../../package.js";
import { loadProjectState, resolveInput } from "../context.js";
import { EXIT, UsageError } from "../errors.js";
import { formatDuration } from "../format.js";

const EXTENSION = sourceExtension();

export const openCommand = {
  name: "open",
  aliases: ["o"],
  group: "Core Commands:",
  summary: "Serve a build and open it in the PenguinMod editor",
  description: `Compile the project, serve the .pmp from a local HTTP server, and
open the PenguinMod editor on it through "?project_url=". The server keeps
serving the build from when it started, so restart the command to see changes.`,
  arguments: [`[input${EXTENSION}|dir]`],
  options: [
    { flags: "--host [host]", description: "Server host" },
    { flags: "--lan", description: "Listen on all interfaces" },
    { flags: "--port <port>", description: "Server port (default 3000)" },
    {
      flags: "--strict-port",
      description: "Fail instead of choosing the next free port",
    },
    {
      flags: "--no-open",
      description: "Print the editor link without a browser",
    },
  ],
  examples: ["fx open", "fx open --port 4000", "fx open --no-open --json"],
  jsonEvents: true,
  async run({ args, options, cwd, reporter, prompts }) {
    const target = resolveInput(args[0], cwd);
    if (target.file && path.extname(target.file).toLowerCase() === ".pmp")
      throw new UsageError(
        "fx open needs .tfx sources or a directory, not a .pmp archive",
      );

    let host = "127.0.0.1";
    if (options.lan) host = "0.0.0.0";
    else if (options.host === true) host = "0.0.0.0";
    else if (typeof options.host === "string") host = options.host;

    if (options.port === true) throw new UsageError("--port needs a number");
    const port = options.port === undefined ? 3000 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new UsageError("--port must be an integer between 0 and 65535");

    const started = performance.now();
    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      prompts,
    });
    const result = build({
      ...state.target,
      projectConfig: state.loaded.project,
      fxConfig: state.loaded.fx,
      catalog: state.catalog,
      extensionUrls: state.extensionUrls,
      useConfigFile: false,
    });
    for (const warning of result.warnings) reporter.warn(warning);

    const filename = `${slugify(
      result.config.name || path.basename(state.configDir),
    )}.pmp`;
    const server = await startEditorServer({
      data: result.sb3,
      filename,
      host,
      port,
      strictPort: Boolean(options.strictPort),
      log: { warn: (message) => reporter.warn(message) },
    });

    const startup = {
      url: server.projectUrl,
      projectUrls: server.projectUrls,
      editorUrl: server.editorUrl,
      editorUrls: server.editorUrls,
      host,
      port: server.port ?? port,
    };
    reporter.event("start", startup);

    const durationMs = Math.round(performance.now() - started);
    if (!reporter.json) {
      reporter.success(`Serving ${filename} (${formatDuration(durationMs)})`);
      reporter.text("");
      reporter.detail("Project", server.projectUrl, { width: 9 });
      server.editorUrls.forEach((link, index) => {
        const label =
          index < server.localUrls.length
            ? index === 0
              ? "Editor"
              : "Local"
            : "Network";
        reporter.detail(label, link, { width: 9 });
      });
      if (state.unsandboxed.length)
        reporter.detail(
          "Unsandboxed",
          `${state.unsandboxed.join(", ")} (must be allowed in the editor)`,
          { width: 9 },
        );
      reporter.text(
        `  ${reporter.muted("Restart to pick up changes. Press Ctrl+C to stop.")}`,
      );
    }

    if (options.open !== false) {
      const opened = await openBrowser(server.editorUrl);
      if (!opened)
        reporter.note(
          "Could not launch a browser; open the editor link above.",
        );
    }

    let stopping = false;
    const shutdown = (signal) => {
      if (stopping) return;
      stopping = true;
      server
        .close()
        .finally(() =>
          process.exit(signal === "SIGINT" ? EXIT.INTERRUPTED : EXIT.OK),
        );
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    return startup;
  },
};
