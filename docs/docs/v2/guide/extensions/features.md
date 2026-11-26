---
title: Project features
description: List, enable, disable, update, and migrate every optional Fx feature from one config key and one command set.
---

# Project features

Fx has a small set of optional features. Every one of them is registered in
the same place and switched under a single `fx.features` key in `fx.yml`, so
you do not need to remember a different setting or command for each one.

| Feature              | What it adds                                            |
| -------------------- | ------------------------------------------------------- |
| `partialSprites`     | `partial sprite` blocks that add to an existing sprite. |
| `tests`              | `test` blocks, `fx test`, and test run settings.        |
| `run`                | Run entry points, the `run.*` blocks, and `fx run`.     |
| `temporaryvariables` | `thread let`, `runtime let`, and the `$`/`$$` sigils.   |

## List and toggle features

Run these commands from inside a project:

```bash
fx feature list
fx feature partialSprites enable
fx feature tests enable
fx feature run enable
fx feature temporaryvariables enable
```

Omit the action to report one feature's status:

```bash
fx feature tests
```

| Action    | What it does                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `list`    | Shows every registered feature and whether it is enabled.                                                       |
| `enable`  | Turns the feature on. Extension-backed features also copy their file into the project.                          |
| `disable` | Turns the feature off. Extension-backed features delete the copy Fx installed.                                  |
| `update`  | Replaces an extension-backed copy with the one bundled in the current Fx version.                               |
| `migrate` | Moves legacy `fx.tests`, `fx.run`, `fx.partialSprites`, and top-level `features:` settings under `fx.features`. |

`enable` refuses to overwrite an extension file that differs from the bundled
copy. Run `update` to replace it, or `enable --force` to do the same thing
directly. `update --dry-run` and `migrate --dry-run` print the diff without
writing.

`disable` deletes an extension file only when its name and contents match the
copy Fx installs. A file you edited or pointed at yourself is kept, even though
its config entry is removed.

Tests and run settings survive a disable/enable cycle: a mapping is written
back with `enabled: false`, so patterns, seeds, and timeouts are not lost.

## Configuration

Everything lives under `fx.features`:

```yaml
fx:
  features:
    partialSprites: true
    tests:
      pattern: "test/**/*.test.tfx"
      timeout: 1000
    run: true
    temporaryvariables: ./extensions/fx-tempvars.js
```

A core feature accepts `true`, `false`, or, for `tests` and `run`, a mapping of
settings. An extension-backed feature accepts `true` (use its bundled filename
under `vendorDir`), `false`, a file path, or `{ file: "<path>" }`.

Older projects may still use `fx.partialSprites`, `fx.tests`, `fx.run`, and a
top-level `features:` mapping. Those settings keep working, and `fx.features`
wins when both forms name the same feature. Run `fx feature migrate` to move
them under the single key; Fx writes a `.bak` copy of `fx.yml` first.

## Temporary variables

The `temporaryvariables` feature is backed by an extension. Enabling it copies
the extension into the project and records the file under `fx.features`:

```yaml
fx:
  features:
    temporaryvariables: ./extensions/fx-tempvars.js
```

The file is committed, so an Fx upgrade never changes a project's feature code,
and the project keeps working offline. Builds load the recorded file as an
extension.

It adds disposable variables to the language. Declare them inside a script with
`thread let` or `runtime let`:

```tfx
when greenFlag {
    thread let hits = 0;
    runtime let bestScore = 0;

    $hits += 1;
    $$bestScore = $hits;
    looks.say($$bestScore);
}
```

- `thread let` creates a variable that belongs to the current script. It disappears when that script stops.
- `runtime let` creates a variable that belongs to the whole project. It lasts until the project stops.
- Read and write a thread variable with `$name`, and a runtime variable with `$$name`.
- Names that start with `$` are reserved for temporary variables, so `let`, `list`, and function parameters can't use them.

The feature's extension also provides blocks under the `fxTempVars` category,
such as checking whether a variable exists, listing active variables, or
deleting runtime variables. Run `fx catalog` to see their exact names.

See [Temporary variables](/guide/language/syntax#temporary-variables) in the
language reference.

## Running

The `run` feature adds headless entry points and the `run.print`, `run.warn`,
`run.error`, `run.assert`, and `run.prompt` blocks. Enable it with
`fx feature run enable`, then put a `main` function in `run/main.run.tfx` and
run it with `fx run`:

```tfx
function main() {
    events.broadcast("ready");
}
```

The `run.*` blocks can be used anywhere in the project. `fx build` ignores
them, while `fx run` compiles and executes them. The feature is built into Fx
rather than vendored, so it has no file to update. See
[Running](/guide/workflow/running) for settings and limitations.
