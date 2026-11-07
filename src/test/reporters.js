/**
 * Test reporters.
 *
 * Every reporter consumes the runner's structured events and owns all
 * formatting, so terminal, JSON, JUnit, and future editors see idential data.
 */
import path from "node:path";

export const REPORTER_NAMES = ["default", "verbose", "dot", "json", "junit"];

const green = (color, text) => (color ? `\x1b[32m${text}\x1b[0m` : text);
const red = (color, text) => (color ? `\x1b[31m${text}\x1b[0m` : text);
const yellow = (color, text) => (color ? `\x1b[33m${text}\x1b[0m` : text);
const dim = (color, text) => (color ? `\x1b[2m${text}\x1b[0m` : text);
const bold = (color, text) => (color ? `\x1b[1m${text}\x1b[0m` : text);

/** Human-readable duration for terminal output. */
function seconds(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Right-align a value in a fixed-width field. */
function pad(value, width) {
  return String(value).padStart(width);
}

/** Summary block printed after a terminal run. */
function summarize(result) {
  const lines = [];
  const { counts } = result;
  const files = `${dim(true, "Test Files")}  ${
    counts.failedFiles ? `${red(true, `${counts.failedFiles} failed`)} | ` : ""
  }${green(true, `${counts.passedFiles} passed`)} (${counts.files})`;
  const tests = `${dim(true, "     Tests")}  ${
    counts.failed ? `${red(true, `${counts.failed} failed`)} | ` : ""
  }${green(true, `${counts.passed} passed`)} (${counts.tests})`;
  lines.push(files, tests);
  if (counts.pending)
    lines.push(`${dim(true, "   Pending")}  ${yellow(true, counts.pending)}`);
  const start = new Date(result.startTime);
  lines.push(
    `${dim(true, "   Start at")}  ${start.toLocaleTimeString([], {
      hour12: false,
    })}`,
  );
  lines.push(`${dim(true, "   Duration")}  ${seconds(result.durationMs)}`);
  return lines.join("\n");
}

/** Failure detail blocks for a terminal run, with source locations. */
function failureBlocks(result, dir) {
  const blocks = [];
  for (const file of result.files) {
    for (const test of file.tests) {
      if (test.status !== "failed" || !test.error) continue;
      const error = test.error;
      const where = error.file
        ? `${error.file}${error.line ? `:${error.line}:${error.column ?? 0}` : ""}`
        : path.relative(dir, file.file);
      blocks.push(
        [
          red(true, `FAIL ${file.file} > ${test.name}`),
          `${error.name}: ${error.message}`,
          dim(true, `❯ ${where}`),
        ].join("\n"),
      );
    }
  }
  return blocks;
}

/** JSON document for `fx test --reporter json` and `--json`. */
export function jsonReport(result, { events = [], warnings = [] } = {}) {
  return {
    schemaVersion: 1,
    command: "test",
    ok: result.ok,
    warnings,
    data: { ...result, events },
  };
}

/** Escape text for use in JUnit attribute values and bodies. */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** JUnit XML for CI integrations. */
export function junitReport(result) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    `<testsuites name="fx" tests="${result.counts.tests}" failures="${result.counts.failed}" time="${(result.durationMs / 1000).toFixed(3)}">`,
  );
  for (const file of result.files) {
    lines.push(
      `  <testsuite name="${escapeXml(file.file)}" tests="${file.tests.length}" failures="${file.tests.filter((t) => t.status === "failed").length}" time="${(file.durationMs / 1000).toFixed(3)}">`,
    );
    for (const test of file.tests) {
      const time = (test.durationMs / 1000).toFixed(3);
      if (test.status === "failed") {
        const message = test.error?.message ?? "failed";
        lines.push(
          `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(file.file)}" time="${time}"><failure message="${escapeXml(message)}" type="${escapeXml(test.error?.name ?? "AssertionError")}">${escapeXml(
            `${test.error?.name ?? "Error"}: ${message}${test.error?.file ? `\n at ${test.error.file}:${test.error.line ?? 0}` : ""}`,
          )}</failure></testcase>`,
        );
      } else if (test.status === "pending") {
        lines.push(
          `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(file.file)}" time="${time}"><skipped/></testcase>`,
        );
      } else {
        lines.push(
          `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(file.file)}" time="${time}"/>`,
        );
      }
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}

/**
 * @param {object} [options]
 * @param {"default"|"verbose"|"dot"|"json"|"junit"} [options.name]
 * @param {NodeJS.WriteStream} [options.stream]
 * @param {boolean} [options.color]
 * @param {boolean} [options.tty]
 * @param {string} [options.dir] project root, for failure locations
 */
export function createTestReporter({
  name = "default",
  stream = process.stdout,
  color = false,
  tty = false,
  dir = process.cwd(),
} = {}) {
  const events = [];
  let liveLine = "";

  const write = (text) => stream.write(text);
  const clearLive = () => {
    if (!liveLine) return;
    write("\r\x1b[2K");
    liveLine = "";
  };
  const live = (text) => {
    clearLive();
    liveLine = text;
    write(`\r${text}`);
  };

  const onEvent = (event) => {
    events.push(event);
    switch (event.event) {
      case "run-start":
        if (name === "default" || name === "verbose")
          write(
            `\n ${bold(color, "RUN")}  ${dim(color, `v${event.version}`)} ${event.dir}\n\n`,
          );
        break;
      case "discovered":
        if (name === "default") {
          for (const file of event.files)
            write(
              `  ${dim(color, "PENDING")}  ${file.file} (${file.tests.length} ${
                file.tests.length === 1 ? "test" : "tests"
              })\n`,
            );
        } else if (name === "verbose") {
          for (const file of event.files)
            for (const test of file.tests)
              write(
                `   ${yellow(color, "↓")} ${file.file} > ${test.name} ${dim(color, test.status)}\n`,
              );
        }
        break;
      case "test-start":
        if (name === "verbose")
          write(
            `   ${dim(color, "▸")} ${event.file} > ${event.name} ${dim(color, event.status)}\n`,
          );
        else if (tty && name === "default")
          live(dim(color, `  ▸ ${event.file} > ${event.name}`));
        break;
      case "test-result":
        clearLive();
        if (name === "verbose") {
          const mark =
            event.status === "passed"
              ? green(color, "✓")
              : event.status === "failed"
                ? red(color, "×")
                : yellow(color, "↓");
          write(
            `   ${mark} ${event.name} ${dim(color, seconds(event.durationMs))}\n`,
          );
        } else if (name === "dot")
          write(
            event.status === "passed"
              ? green(color, "·")
              : event.status === "failed"
                ? red(color, "×")
                : yellow(color, "↓"),
          );
        break;
      case "file-result": {
        if (name !== "default" && name !== "verbose") break;
        const failed = event.tests.filter((test) => test.status === "failed");
        const detail = failed.length
          ? `${event.tests.length} tests | ${failed.length} failed`
          : `${event.tests.length} ${event.tests.length === 1 ? "test" : "tests"}`;
        const mark =
          event.status === "passed" ? green(color, "✓") : red(color, "×");
        write(
          `${mark} ${event.file} ${dim(color, `(${detail}) ${seconds(event.durationMs)}`)}\n`,
        );
        break;
      }
      case "diagnostic":
        clearLive();
        // JSON and JUnit own the whole stream: a plain diagnostic line would
        // make the document unparseable. Both reporters carry diagnostics in
        // their structured payload instead.
        if (name === "json" || name === "junit") break;
        write(
          `${red(color, "×")} ${event.file ?? "<project>"}${
            event.line ? `:${event.line}` : ""
          } ${event.message}\n`,
        );
        break;
      case "run-end":
        clearLive();
        if (name === "dot") write("\n");
        if (name === "json") {
          write(`${JSON.stringify(jsonReport(event.result, { events }))}\n`);
          break;
        }
        if (name === "junit") {
          write(`${junitReport(event.result)}\n`);
          break;
        }
        if (name === "default" || name === "verbose") {
          const blocks = failureBlocks(event.result, dir);
          if (blocks.length) {
            write(
              `\n${red(color, `⎯⎯⎯ Failed Tests ${event.result.counts.failed} ⎯⎯⎯`)}\n\n`,
            );
            write(`${blocks.join("\n\n")}\n`);
          }
          for (const diagnostic of event.result.diagnostics)
            if (!event.result.files.length)
              write(`${red(color, "×")} ${diagnostic.message}\n`);
          write(`\n${summarize(event.result)}\n\n`);
        }
        break;
      default:
        break;
    }
  };

  return { name, onEvent, events };
}

export { pad, seconds };
