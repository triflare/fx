---
title: Formatting
description: Rewrite .tfx files in the canonical style with fx fmt, including check, stdin, stdout, and style rules.
---

# Formatting

Run `fx fmt` to format every `.tfx` source in the current directory, or pass a file or directory:

```bash
fx fmt
fx fmt src/main.tfx
fx fmt src/ --check
cat src/main.tfx | fx fmt --stdin
fx fmt src/main.tfx --stdout
```

| Option     | What it does                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--check`  | Leaves files untouched and exits with status 1 if formatting is needed, 0 if everything is formatted.                         |
| `--stdin`  | Reads source from standard input and writes formatted source to standard output. It takes no file argument.                   |
| `--stdout` | Writes formatted source for a single file to standard output without changing the file. It cannot be combined with `--check`. |

Add `--json` for a structured result, including formatted code for `--stdin` and `--stdout`.

Formatting is idempotent: running it twice produces no further changes. It preserves comments, declaration order, and project data, normalizes whitespace and line endings, and does not compile the project. Files with parse errors are left untouched and reported.

## What the canonical style looks like

`fx fmt` uses one canonical style:

- Four-space indentation, one statement per line.
- `{` stays on the same line as its header, and `} else {` joins alternates.
- Single spaces around operators, after commas, and after colons.
- Double-quoted strings with minimal escapes.
- Declaration order and project data are unchanged.

```tfx
sprite "Cat" {
    costumes: {
        cat: "../assets/cat.svg"
    };

    when greenFlag {
        control.forever {
            motion.turnRight(1);
        }
    }
}
```

Format before committing, or add `fx fmt --check` to CI to keep a repository from drifting.
