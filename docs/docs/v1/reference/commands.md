---
title: Command reference
description: Every v1 fx command and option, including build, check, catalog, package, dev, decompile, init, extension, and sprite.
---

# Command reference

Every Triflare Fx command starts with `fx`. You can use `fx` after a global install, or `npx @triflare/fx` without installing.

Run `fx help` to see a short summary in the terminal.

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

Reads and parses the source files and reports syntax errors, duplicate sprites, and configuration problems. It doesn't compile the project, so unknown blocks and variables aren't reported. Run `fx build` for a full check.

Alias: `c`

### fx catalog

```bash
fx catalog [<dir>] [--json]
```

Lists every block you can use, including blocks from extensions in `fx.yml`. Each line shows the block name, its PenguinMod opcode, and its kind. `--json` prints the same information as JSON.

Alias: `l`

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

### fx extension

```bash
fx extension add <path|url> [--unsandboxed <id>]
fx extension remove <source|id>
fx extension list [--json]
```

Edits the `project.extensions` and `project.unsandboxed` lists in `fx.yml`. `add` records a path or web address, and `remove` accepts the same path or URL, or the extension's ID. `list` prints the configured extensions and the unsandboxed list.

`--unsandboxed <id>` records an extension ID in `project.unsandboxed` so it may run unsandboxed.

See [Extensions](/guide/extensions/extensions).

### fx sprite

```bash
fx sprite add <url|file> [--name <name>] [--force]
fx sprite build <name> [-o <output.pms>] [--no-config]
fx sprite remove <name>
fx sprite list [<dir>] [--json]
```

Imports, exports, removes, and lists sprites. See [Sprites](/guide/extensions/sprites) for details.

## Global options

These options apply to every command.

| Option         | What it does                       |
| -------------- | ---------------------------------- |
| `-v`, `--version` | Prints the version.             |
| `-h`, `--help`    | Prints the command summary.      |

In v1, `-v` prints the version. It is not a verbosity flag.

`--json` selects machine-readable output for `fx catalog`, `fx extension list`, and `fx sprite list`.

## Command aliases

| Alias | Command     |
| ----- | ----------- |
| `b`   | `build`     |
| `c`   | `check`     |
| `l`   | `catalog`   |
| `p`   | `package`   |
| `d`   | `decompile` |
| `i`   | `init`      |

For example, `fx b` is the same as `fx build`.
