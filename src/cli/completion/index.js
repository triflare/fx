/**
 * Shell completion support.
 *
 * Completion is intentionally data-driven: the hidden `__complete` command
 * walks the live commander tree, so new commands and options are completed
 * without maintaining a second list.
 */

const VALUE_OPTIONS = {
  "--color": ["auto", "always", "never"],
  "--cwd": [],
  "--config": [],
  "--template": ["cat", "empty", "blank"],
  "--target": ["html", "zip", "windows", "macos", "linux"],
  "--size": ["480x360", "640x360", "1920x1080"],
};

function commandFor(program, words) {
  let command = program;
  for (const word of words) {
    if (word.startsWith("-")) continue;
    const next = command.commands.find(
      (entry) => entry.name() === word || entry.aliases().includes(word),
    );
    if (!next) break;
    command = next;
  }
  return command;
}

function commandWords(command) {
  const words = new Set();
  for (const entry of command.commands) {
    if (entry._hidden) continue;
    words.add(entry.name());
    for (const alias of entry.aliases()) words.add(alias);
  }
  return [...words];
}

function optionWords(command) {
  const words = new Set();
  for (let current = command; current; current = current.parent) {
    for (const option of current.options) {
      if (option.hidden) continue;
      if (option.long) words.add(option.long);
      if (option.short) words.add(option.short);
    }
  }
  return [...words];
}

/** Candidate completions for the words typed after the command name. */
export function completionCandidates(program, words) {
  const current = words.at(-1) ?? "";
  const before = words.slice(0, -1).filter((word) => word !== "");
  const command = commandFor(program, before);

  // `--color=` style value completion.
  if (current.includes("=")) {
    const [flag, prefix] = current.split("=", 2);
    const values = VALUE_OPTIONS[flag] ?? [];
    return values
      .filter((value) => value.startsWith(prefix))
      .map((value) => `${flag}=${value}`);
  }

  // A value is expected for the previous token.
  const previous = before.at(-1);
  if (previous && Object.hasOwn(VALUE_OPTIONS, previous)) {
    const values = VALUE_OPTIONS[previous];
    return values.filter((value) => value.startsWith(current));
  }

  const candidates = new Set();
  if (current.startsWith("-")) {
    for (const option of optionWords(command)) {
      if (option.startsWith(current)) candidates.add(option);
    }
    return [...candidates].sort();
  }

  // Groups with subcommands (the root, vendor, sprite, ...) offer their
  // command words; leaf commands have none.
  if (command.commands.length > 0) {
    for (const word of commandWords(command))
      if (word.startsWith(current)) candidates.add(word);
  }

  // Positional values that are useful and finite.
  if (command.name() === "completion") {
    for (const shell of ["bash", "zsh", "fish"])
      if (shell.startsWith(current)) candidates.add(shell);
  }

  return [...candidates].sort();
}
