import fs from "node:fs";
import { parse } from "../../parser.js";
import { discoverSources, mergePrograms } from "../../project.js";
import { sourceExtension } from "../../brand.js";
import { loadProjectState } from "../context.js";
import { UsageError } from "../errors.js";

const EXTENSION = sourceExtension();

export const checkCommand = {
  name: "check",
  aliases: ["c"],
  group: "Core Commands:",
  summary: "Parse sources and report errors",
  description: `Parse a file, or every ${EXTENSION} file in a directory, without
building an archive.`,
  arguments: [`[input${EXTENSION}|dir]`],
  examples: ["fx check", "fx check src/main.tfx"],
  async run({ args, cwd, options, reporter }) {
    const state = await loadProjectState({
      input: args[0],
      cwd,
      options,
      reporter,
      includeExtensions: false,
      migrateLegacy: false,
    });
    const { target, loaded } = state;
    const files = target.file ? [target.file] : discoverSources(target.dir);
    if (files.length === 0)
      throw new UsageError(`No ${EXTENSION} files found under ${target.dir}`);

    const entries = files.map((file) => ({
      ast: parse(fs.readFileSync(file, "utf8"), file),
      file,
    }));
    mergePrograms(entries, {
      partialSprites: loaded.fx?.partialSprites ?? false,
    });

    reporter.success(`Checked ${files.length} file(s): OK`);
    return { files, ok: true };
  },
};
