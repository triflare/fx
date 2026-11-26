---
title: Command reference
description: Every fx command and option, including build, check, lint, fmt, test, catalog, package, dev, decompile, vendor, feature, sprite, and completion.
---

# Command reference

Every Triflare Fx command starts with `fx`. You can use `fx` after a global install, or `npx @triflare/fx` without installing.

Run `fx help` to see a short summary in the terminal, or `fx <command> --help` for one command.

## Commands

### fx init

```bash
fx init [dir]
```

Creates a new project in `dir`, or in the current folder if you don't name one. Writes `fx.yml`, `src/main.tfx`, and `assets/cat.svg`, and skips any file that already exists.

Alias: `i`

### fx build

```bash
fx build [<input.tfx>|<dir>] [-o <output.pmp>] [--no-config]
```

Compiles a source file, or every `.tfx` file in a folder, into one `.pmp` project. Without an input, builds the current folder.

| Option           | What it does                                |
| ---------------- | ------------------------------------------- |
| `-o`, `--output` | Writes the project to a specific path.      |
| `--no-config`    | Ignores `fx.yml` and uses default settings. |

Alias: `b`

### fx check

```bash
fx check [<input.tfx>|<dir>] [--no-config]
```

Reads and parses the source files and reports syntax errors, duplicate sprites, and configuration problems. It doesn't compile the project, so unknown blocks and variables aren't reported. Run `fx lint` or `fx build` for a full check.

Alias: `c`

### fx lint

```bash
fx lint [<input.tfx>|<dir>] [--fix] [--strict] [--preset <name>] [--rule <id[=severity]>]
```

Statically analyses the sources and the merged project. Rules come from the `fx.lint` block in `fx.yml`; flags override them.

| Option                 | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `--fix`                | Applies safe, explicit fixes.                                       |
| `--strict`             | Uses at least the `strict` preset and fails when warnings are reported. |
| `--preset <name>`      | `minimal`, `recommended`, `strict`, or `all`.                       |
| `--rule <id[=severity]>` | Enables, disables, or re-levels one rule. Repeatable.             |

See [Linting](/guide/workflow/linting) for the rule list and configuration.

### fx fmt

```bash
fx fmt [<input.tfx>|<dir>] [--check] [--stdin] [--stdout]
```

Rewrites a file, or every `.tfx` file in a directory, in the canonical source format. Formatting is idempotent and never compiles a project.

| Option     | What it does                                                              |
| ---------- | ------------------------------------------------------------------------- |
| `--check`  | Writes nothing and exits 1 if formatting is needed.                       |
| `--stdin`  | Formats source read from standard input. Takes no file argument.          |
| `--stdout` | Writes formatted source for one file to standard output without changing it. |

`--stdout` cannot be combined with `--check`. See [Formatting](/guide/workflow/formatting).

Alias: `format`

### fx catalog

```bash
fx catalog [<dir>] [--category <name>] [--search <text>] [--json]
```

Lists every block you can use, grouped by category, including blocks from extensions configured in `fx.yml`. Each block shows its arguments in `SCREAMING_SNAKE_CASE`, the same style extensions use, so `motion.moveSteps(STEPS)` tells you what to pass.

A one-character marker shows the kind of block: `→` returns a value, `?` is true/false, `▸` is an event, and a block with no marker is a command.

| Option              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `--category <name>` | Shows one category, such as `motion` or `pen`. |
| `--search <text>`   | Shows blocks whose name contains the text.     |

`--verbose` also shows each block's PenguinMod opcode, kind, and extension. `--json` prints the same information as JSON, filtered like the text output.

Aliases: `l`, `blocks`

### fx package

```bash
fx package [<input.tfx>|<input.pmp>|<dir>] [-o <output>] [--target <target>] [--extract] [--no-config]
```

Builds a project, or reads an existing `.pmp`, and packages it as HTML or a ZIP.

| Option           | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `--target <t>`   | `html`, `zip`, `zip-one-asset`, `windows`, `macos`, or `linux`.  |
| `-o`, `--output` | The output file or folder.                                       |
| `--extract`      | Unzips the result after packaging. ZIP and desktop targets only. |
| `--no-config`    | Ignores `fx.yml` and uses default settings.                      |

Alias: `p`

See [Building and packaging](/guide/workflow/building) for details.

### fx dev

```bash
fx dev [<input.tfx>|<dir>] [--host [host]] [--lan] [--port <port>] [--strict-port] [--no-config]
```

Builds the project and serves it at `http://127.0.0.1:3000/`, reloading the page when the output changes.

| Option          | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `--port <port>` | Selects the port. Default is `3000`.                         |
| `--strict-port` | Fails when the port is taken instead of trying the next one. |
| `--lan`         | Listens on all interfaces so other devices can connect.      |
| `--host [host]` | Listens on a host. With no value, listens on all interfaces. |
| `--no-config`   | Ignores `fx.yml` and uses default settings.                  |

`fx dev` needs `.tfx` sources. It can't serve a `.pmp` file.

### fx decompile

```bash
fx decompile <input.pmp> [-o <output.tfx>] [--assets <dir>] [--fetch-extensions]
```

Converts a PenguinMod or Scratch project into Triflare Fx source. Without `-o`, the source is printed to the terminal.

| Option               | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `-o`, `--output`     | Writes the source to a file.                               |
| `--assets <dir>`     | Extracts costumes and sounds into a folder.                |
| `--fetch-extensions` | Downloads extensions from web addresses while decompiling. |

Alias: `d`

See [Decompiling](/guide/workflow/decompiling) for details.

### fx vendor

```bash
fx vendor add <source> [--as <name>] [--unsandboxed] [--force]
fx vendor install
fx vendor update [name] [--dry-run]
fx vendor outdated
fx vendor verify
fx vendor remove <name>
fx vendor list [--json]
fx vendor migrate [--yes]
```

Copies extensions into the vendor directory, records their hashes in `fx.lock`, and loads them from there. See [Vendoring extensions](/guide/extensions/vendoring).

`<source>` may be a URL, a local path, or a Triflare Marketplace package such as `marketplace:@handle/extension@beta`. Marketplace packages resolve to a pinned download URL before they are vendored. `fx vendor install` also accepts `<source>` for compatibility, but `fx vendor add` is the current form.

### fx feature

```bash
fx feature [name] [action] [--force] [--dry-run]
fx feature list
fx feature migrate [--dry-run]
```

Lists, installs, updates, or removes an optional feature. Actions are `enable`, `update`, and `disable`; omit the action for a status report. With no name, `fx feature` lists every registered feature. All switches live under `fx.features` in `fx.yml`.

The `partialSprites`, `tests`, and `run` features are built into Fx rather than vendored: they support `enable` and `disable`, and `update` fails because there is no vendored file or lock entry. `temporaryvariables` is extension-backed and supports `update` too.

`fx feature migrate` moves the legacy `fx.tests`, `fx.run`, `fx.partialSprites`, and top-level `features:` settings under `fx.features`, writing a `.bak` copy of the config first.

| Option      | What it does                                          |
| ----------- | ----------------------------------------------------- |
| `--force`   | Replaces an installed copy that was edited (`enable`). |
| `--dry-run` | Previews an update or migration without writing files. |

See [Project features](/guide/extensions/features).

### fx test

```bash
fx test [<files...>] [--filter <text>] [--watch] [--reporter <name>] [--seed <number>] [--timeout <ms>]
```

Builds the project and runs every test file (`test/**/*.test.tfx` by default), starting each test with a fresh copy of the project. Testing must be enabled first with `fx feature tests enable`.

| Option           | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `-t`, `--filter` | Runs only tests whose name or file contains the text.                 |
| `-w`, `--watch`  | Re-runs when `.tfx` or `fx.yml` files change.                         |
| `--run`          | Runs once and exits. This is the default.                             |
| `--reporter`     | `default`, `verbose`, `dot`, `json`, or `junit`.                      |
| `--seed`         | Overrides `fx.features.tests.seed` for this run.                      |
| `--timeout`      | Overrides `fx.features.tests.timeout` for this run.                   |

Exit codes: `0` all tests passed, `1` a test failed, `2` parse or configuration error, `3` interrupted, `4` invalid usage.

See [Testing](/guide/workflow/testing) for test syntax, actions, state queries, and configuration.

### fx run

```bash
fx run [<files...>] [--timeout <ms>] [--seed <number>] [--ticks-per-second <number>] [--allow-project-extensions] [--allow-external-io]
```

Compiles the project together with its run files, then executes the `main` function from the run file (`run/**/*.run.tfx` by default) in a fresh headless VM. `run.print` output is written as it happens. Running must be enabled first with `fx feature run enable`. Project extensions are blocked unless `--allow-project-extensions` is passed.

| Option                       | What it does                                                          |
| ---------------------------- | --------------------------------------------------------------------- |
| `--timeout`                  | Overrides `fx.features.run.timeout` for this run.                    |
| `--seed`                     | Overrides `fx.features.run.seed` for this run.                       |
| `--ticks-per-second`         | Overrides the simulated frame rate for this run.                     |
| `--allow-project-extensions` | Trusts and loads this project's extensions for this run.             |
| `--allow-external-io`        | Allows network access (`fetch` and `WebSocket`) during a run.         |

Exit codes: `0` the run completed, `1` the run failed or timed out, `2` parse, build, configuration, or project-load error, `4` invalid usage.

See [Running](/guide/workflow/running) for run files, output, settings, and limitations.

### fx sprite

```bash
fx sprite add <url|file> [--name <name>] [--force]
fx sprite build <name> [-o <output.pms>] [--no-config]
fx sprite remove <name>
fx sprite list [<dir>] [--json]
```

Imports, exports, removes, and lists sprites. See [Sprites](/guide/extensions/sprites) for details.

### fx completion

```bash
fx completion <bash|zsh|fish>
```

Prints a completion script. Add it to your shell profile, or source it directly:

```bash
fx completion bash >> ~/.bashrc
fx completion zsh > ~/.zfunc/_fx
fx completion fish > ~/.config/fish/completions/fx.fish
```

### fx extension

```bash
fx extension add <path|url> [--unsandboxed <id>]
fx extension remove <source|path|url|id>
fx extension list [--json]
```

Deprecated commands that edit the legacy `project.extensions` list. They are hidden from help. Use `fx vendor` for new projects, and `fx vendor migrate` to convert an existing project. See [Extensions](/guide/extensions/extensions#legacy-extension-commands).

## Global options

These options work with every command.

| Option                 | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `-v`, `--verbose`      | Shows timings, stack traces, and extra detail.      |
| `--json`               | Emits machine-readable JSON.                        |
| `-q`, `--quiet`        | Suppresses success and informational output.        |
| `--color <mode>`       | Color output: `auto`, `always`, or `never`.         |
| `--no-color`           | Disables color output.                              |
| `--cwd <dir>`          | Runs as if started in `dir`.                        |
| `--config <file>`      | Uses a specific config file.                        |
| `--no-config`          | Ignores the project config file.                    |
| `--no-input`           | Never prompts for input.                            |
| `-y`, `--yes`          | Accepts defaults and confirms destructive actions.  |
| `--no-upgrade-prompt`  | Does not offer to migrate `project.extensions`.    |
| `-V`, `--version`      | Prints the version.                                 |
| `-h`, `--help`         | Prints the command summary.                         |

## Command aliases

| Alias    | Command     |
| -------- | ----------- |
| `b`      | `build`     |
| `c`      | `check`     |
| `l`      | `catalog`   |
| `blocks` | `catalog`   |
| `p`      | `package`   |
| `d`      | `decompile` |
| `i`      | `init`      |
| `format` | `fmt`       |

For example, `fx b` is the same as `fx build`.
