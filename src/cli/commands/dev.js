import crypto from "node:crypto";
import path from "node:path";
import { build } from "../../build.js";
import { sourceExtension } from "../../brand.js";
import { packageSignature, resolvePackageConfig } from "../../package.js";
import { packageProject } from "../../packager.js";
import { startDevServer } from "../../dev.js";
import { loadProjectState, resolveInput } from "../context.js";
import { EXIT, UsageError, errorToJson } from "../errors.js";

const EXTENSION = sourceExtension();

export const devCommand = {
  name: "dev",
  group: "Core Commands:",
  summary: "Serve a live build and reload on changes",
  description: `Build and serve the project as HTML, rebuilding when sources or
configuration change.`,
  arguments: [`[input${EXTENSION}|dir]`],
  options: [
    { flags: "--host [host]", description: "Dev server host" },
    { flags: "--lan", description: "Listen on all interfaces" },
    { flags: "--port <port>", description: "Dev server port (default 3000)" },
    {
      flags: "--strict-port",
      description: "Fail instead of choosing the next free port",
    },
  ],
  examples: ["fx dev", "fx dev --lan --port 8080", "fx dev --json"],
  jsonEvents: true,
  async run({ args, options, cwd, reporter, prompts, product }) {
    const target = resolveInput(args[0], cwd);
    if (target.file && path.extname(target.file).toLowerCase() === ".pmp")
      throw new UsageError(
        "fx dev needs .tfx sources or a directory, not a .pmp archive",
      );

    let host = "127.0.0.1";
    if (options.lan) host = "0.0.0.0";
    else if (options.host === true) host = "0.0.0.0";
    else if (typeof options.host === "string") host = options.host;

    if (options.port === true) throw new UsageError("--port needs a number");
    const port = options.port === undefined ? 3000 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new UsageError("--port must be an integer between 0 and 65535");

    const initialState = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      prompts,
      includeExtensions: false,
    });
    const watchDir = initialState.configDir;

    let lastSb3Hash = null;
    let lastSignature = null;
    let lastHtml = null;

    const buildForDev = async () => {
      const started = performance.now();
      const state = await loadProjectState({
        input: args[0],
        cwd,
        options,
        reporter,
        prompts,
        includeExtensions: true,
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

      const pkg = resolvePackageConfig(state.loaded.package, {
        baseDir: state.configDir,
        projectName: result.config.name,
      });
      pkg.target = "html";

      const signature = packageSignature(pkg);
      const sb3Hash = crypto
        .createHash("sha256")
        .update(result.sb3)
        .digest("hex");
      if (
        lastHtml != null &&
        sb3Hash === lastSb3Hash &&
        signature === lastSignature
      )
        return lastHtml;

      const spinner = prompts.spinner();
      spinner.start("Packaging project...");
      let packaged;
      try {
        packaged = await packageProject({
          sb3: result.sb3,
          projectName: result.config.name,
          packageConfig: pkg,
          onProgress: (message) => spinner.message(String(message)),
        });
      } finally {
        spinner.stop();
      }
      lastSb3Hash = sb3Hash;
      lastSignature = signature;
      lastHtml = packaged.html ?? packaged.data.toString("utf8");
      reporter.event("build", {
        durationMs: Math.round(performance.now() - started),
        targets: result.project.targets.length,
      });
      return lastHtml;
    };

    const server = await startDevServer({
      watchDir,
      build: buildForDev,
      host,
      port,
      strictPort: Boolean(options.strictPort),
      log: {
        error: (message) => {
          reporter.error(message);
          reporter.event("error", {
            error: errorToJson(new Error(String(message))),
          });
        },
        success: (message) => reporter.success(message),
        warn: (message) => reporter.warn(message),
        info: (message) => reporter.info(message),
      },
    });

    const startup = {
      url: server.url,
      localUrls: server.localUrls,
      networkUrls: server.networkUrls,
      host,
      port: server.port ?? port,
    };
    reporter.event("start", startup);

    if (!reporter.json) {
      reporter.text("");
      reporter.text(
        `  ${reporter.brand(product.name)} ${reporter.muted("dev")}`,
      );
      for (const url of server.localUrls)
        reporter.detail("Local", url, { width: 9 });
      for (const url of server.networkUrls)
        reporter.detail("Network", url, { width: 9 });
      reporter.text(`  ${reporter.muted("Press Ctrl+C to stop.")}`);
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

    await server.ready;
    return startup;
  },
};
