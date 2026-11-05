import { completionCandidates } from "../completion/index.js";
import { bashCompletion } from "../completion/bash.js";
import { fishCompletion } from "../completion/fish.js";
import { zshCompletion } from "../completion/zsh.js";
import { UsageError } from "../errors.js";

const SHELLS = new Set(["bash", "zsh", "fish"]);

export const completionCommand = {
  name: "completion",
  group: "Utility Commands:",
  summary: "Print shell completion setup",
  description: `Print a completion script for bash, zsh, or fish. Add the script
to your shell profile, or source it directly.`,
  arguments: ["<shell>"],
  examples: [
    "fx completion bash >> ~/.bashrc",
    "fx completion zsh > ~/.zfunc/_fx",
    "fx completion fish > ~/.config/fish/completions/fx.fish",
  ],
  run({ args, reporter, product }) {
    const shell = args[0];
    if (!SHELLS.has(shell))
      throw new UsageError(
        `completion requires one of: ${[...SHELLS].join(", ")}`,
      );
    const command = product.command;
    const script =
      shell === "bash"
        ? bashCompletion(command)
        : shell === "zsh"
          ? zshCompletion(command)
          : fishCompletion(command);
    reporter.text(script.endsWith("\n") ? script.slice(0, -1) : script);
    return { shell, script };
  },
};

export const completeCommand = {
  name: "__complete",
  hidden: true,
  summary: "Internal shell completion protocol",
  arguments: ["[words...]"],
  run({ args, command, reporter }) {
    const words = args[0] == null ? [] : args[0];
    const list = Array.isArray(words) ? words : [words];
    const program = command.parent ?? command;
    // The generated shell scripts pass their own name first as a marker.
    const input = SHELLS.has(list[0]) ? list.slice(1) : list;
    const candidates = completionCandidates(program, input);
    if (candidates.length > 0) reporter.text(candidates.join("\n"));
    return { candidates };
  },
};
