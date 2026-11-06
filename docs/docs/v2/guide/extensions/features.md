---
title: Project features
description: Enable extension-backed language features such as temporary variables, then update or disable the committed copy.
---

# Project features

Features are extension-backed language additions that ship with Triflare Fx. Enabling a feature copies its extension file into the project and records it under `features:` in `fx.yml`. The file is committed, so an Fx upgrade never changes a project's feature code, and the project keeps working offline.

## Enable, update, or disable a feature

Run these commands from inside a project:

```bash
fx feature temporaryvariables enable
fx feature temporaryvariables update
fx feature temporaryvariables disable
```

| Action    | What it does                                                                 |
| --------- | ---------------------------------------------------------------------------- |
| `enable`  | Copies the feature's file into the vendor folder and records it in `fx.yml`. |
| `update`  | Replaces the copy with the one bundled in the current Fx version.            |
| `disable` | Removes the `fx.yml` entry and deletes the copy Fx installed.                |

`enable` refuses to overwrite a file that differs from the bundled copy. Run `update` to replace it, or `enable --force` to do the same thing directly. `update --dry-run` prints the diff without writing.

`disable` deletes a file only when its name and contents match the copy Fx installs. A file you edited or pointed at yourself is kept, even though its `features:` entry is removed.

After enabling, the recorded entry looks like this:

```yaml
features:
  temporaryvariables: ./extensions/fx-tempvars.js
```

Builds load every file listed under `features:` as an extension.

## Temporary variables

The `temporaryvariables` feature adds disposable variables to the language. Declare them inside a script with `thread let` or `runtime let`:

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

The feature's extension also provides blocks under the `fxTempVars` category, such as checking whether a variable exists, listing active variables, or deleting runtime variables. Run `fx catalog` to see their exact names.

See [Temporary variables](/guide/language/syntax#temporary-variables) in the language reference.
