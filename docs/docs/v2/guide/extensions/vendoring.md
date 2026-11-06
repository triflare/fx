---
title: Vendoring extensions
description: Commit a verified copy of each extension, record hashes in fx.lock, and update, verify, or migrate entries offline.
---

# Vendoring extensions

Extension URLs are mutable and can disappear, so Triflare Fx can commit a verified copy of every extension instead. A vendored extension is a normal JavaScript file in the project, with its hash recorded in `fx.lock`.

## How it works

Declare extensions under `vendor:` in `fx.yml`. Order is load order:

```yaml
vendorDir: extensions # default
vendor:
  signals: https://example.com/signals.js
  xterm:
    url: http://localhost:8080/xterm.js
    volatile: true
  mything: ./src/mything.js
```

`fx vendor add <url|path> --as <name>` copies the source to `extensions/`, records its SHA-256 in `fx.lock`, and adds it to `fx.yml`. Builds load the vendored copy and embed its source, so no network access is needed after installation.

- **Remote entries** fail if their hash changes. The lock file is the pin.
- **Volatile entries** warn instead of failing. Localhost URLs are volatile automatically, because a development server can change between builds.
- **Local paths** remain the source of truth and are re-copied on each build with a generated-file header.
- `vendorDir` must be a directory inside the project directory. Set it at the top level of `fx.yml` or under `fx:`.

Commit `fx.yml`, `fx.lock`, and the vendor folder. Anyone who clones the project can then build it without network access.

## Add an extension

```bash
fx vendor add https://example.com/signals.js --as signals
fx vendor add ./src/mything.js
```

| Option          | What it does                                     |
| --------------- | ------------------------------------------------ |
| `--as <name>`   | Names the entry. Defaults to the file name stem. |
| `--unsandboxed` | Allows the extension to run unsandboxed.         |
| `--force`       | Replaces an existing entry with the same name.   |

## Keep vendored files up to date

| Command                      | What it does                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| `fx vendor install`          | Restores missing files from `fx.lock`, fetching only what's absent.       |
| `fx vendor update [name]`    | Re-fetches upstream, writes changed files and `fx.lock`, and shows diffs. |
| `fx vendor update --dry-run` | Previews the diffs without writing.                                       |
| `fx vendor outdated`         | Compares upstream sources with `fx.lock`.                                 |
| `fx vendor verify`           | Checks the files against `fx.lock`, offline.                              |
| `fx vendor list`             | Lists entries, their files, and their flags.                              |
| `fx vendor remove <name>`    | Removes the entry, its lock record, and its file.                         |

`fx vendor verify` exits with status 1 when a file is missing or its hash doesn't match. Use it in CI before packaging.

`fx vendor update` exits with status 1 only when an entry reports an error, so a changed upstream file is a normal, fixable result.

## Volatile entries

A volatile entry is expected to change. Instead of failing the build when its hash differs from `fx.lock`, Triflare Fx prints a warning and uses the new file.

```yaml
vendor:
  xterm:
    url: http://localhost:8080/xterm.js
    volatile: true
```

Automatic volatility only applies to loopback addresses: `localhost`, `*.localhost`, `127.*`, `0.0.0.0`, and `::1`. Any other URL is pinned unless you set `volatile` explicitly.

## Migrate from project.extensions

Older projects use a plain list under `project.extensions`. To move those entries into the vendor system:

```bash
fx vendor migrate
```

The command writes `fx.yml.bak`, shows the config diff, and copies each extension into the vendor folder. In a terminal it asks for a name for each entry; pass `--yes` to accept the defaults.

Builds only offer this migration when they run in a terminal. Use `--no-upgrade-prompt` or `FX_NO_PROMPT=1` to keep the legacy `project.extensions` behavior without being asked.

## Extensions when decompiling

When you [decompile](/guide/workflow/decompiling) a project, the extensions it uses are restored into the same vendor system, so the decompiled project builds offline like the original.
