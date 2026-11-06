---
title: Troubleshooting
description: Fix the most common build, extension, decompile, and packaging errors from Triflare Fx v1.
---

# Troubleshooting

Start with `fx check` for syntax errors, then `fx build` for a full build. Triflare Fx stops at the first error and shows the file, line, and column:

```text
CompileError: Unknown variable "scroe"
  --> src/main.tfx:12:9
12 |     scroe += 1;
   |         ^
```

Fix that error and run the command again. This page covers the errors you're most likely to see.

## The command can't find the project

**`No .tfx files found under <folder>`**

The folder doesn't contain any `.tfx` files, or you're in the wrong folder. Run `fx build` from the project root, or pass the folder as an argument.

**`input not found: <path>`**

The path you passed doesn't exist. Check the spelling and whether you meant to name a folder instead of a file.

**`No fx.yml found.`**

The `extension` commands need a project. Run them from inside a folder with `fx.yml`, or create a project with `fx init`.

## Build errors

**`Unknown block or function "<name>"`**

The block name doesn't match anything in the catalog. Check the spelling and capitalization, and run `fx catalog` to see the exact name. Blocks from extensions only appear after you add the extension to `fx.yml`.

**`Unknown variable "<name>"`**

The variable hasn't been declared. Add `let name = 0;` to the sprite, or to the stage if every sprite should share it. See [Variables and lists](/guide/language/syntax#variables-and-lists).

**`Statements must appear inside a 'when ... { }' hat block`**

Code was written outside an event. Move it inside `when greenFlag { … }` or another event.

**`Duplicate sprite "Name"`**

Two files declare the same sprite. Merge them into one file, or turn on partial sprites and use `partial sprite "Name" { … }` in the second file. See [Projects and fx.yml](/guide/start/projects#split-a-sprite-across-files).

**`partial sprite "Name" is disabled`**

Add this to `fx.yml`:

```yaml
fx:
  partialSprites: true
```

**`A project may only declare one stage`**

More than one file has a `stage { … }` block. Keep one stage block and move the rest of the stage code to the top level, or into the one stage block.

**`Duplicate variable "Name"`**

The same variable is declared twice in one sprite, or twice at the global level. Remove one declaration and reuse the name.

**`No statements can follow 'return'`**

`return`, `control.stop("all")`, `control.stop("this script")`, and `control.deleteThisClone()` end a script. Remove the code below it, or move that code before the block.

**`<block> returns a value and cannot be used as a statement`**

A returning function or reporter block was called on its own. Use its value, for example `looks.say(mood());` instead of `mood();`.

**`Expected ";" but found …`**

A statement is missing its semicolon, or a bracket or string isn't closed. The caret in the error shows the exact spot.

## Build warnings

**`extension ... did not call Scratch.extensions.register()`**

The file isn't a PenguinMod extension, or its setup failed silently. Check that it calls `Scratch.extensions.register()`.

**`extension ... requires unsandboxed mode`**

The extension only works when PenguinMod allows it to run unsandboxed. Allow it when the project opens, or mark it unsandboxed in `fx.yml` once you trust it. See [Extensions](/guide/extensions/extensions#unsandboxed-extensions).

**`failed to load extension ...`**

The extension couldn't be read or run. Check the path or URL. When you run a build without a network connection, a web-hosted extension can't be loaded. The build continues without its blocks.

## Decompiling

**`Not a Scratch project: missing project.json`**

The file isn't a Scratch 3 or PenguinMod project. Make sure you passed a `.pmp` or `.sb3` archive, not an image or a renamed file.

**`// unsupported block <opcode>` in the output**

The project uses a block Triflare Fx doesn't know. If the block comes from an extension, add the extension to the project and decompile again. If the extension is stored at a web address, pass `--fetch-extensions`.

**Extensions weren't written to `extensions/`**

Triflare Fx never overwrites a file or writes through a symbolic link. If a file with the same name already exists, the archive's copy is kept inside `fx.yml` and a warning explains why. Delete or rename the file and decompile again.

## Packaging and the dev server

**`--extract only applies to zip and desktop targets`**

Remove `--extract` when packaging for `html`, or choose a ZIP or desktop target.

**The packager isn't built**

This only happens in a source checkout. Run `npm run build:packager` in the Triflare Fx folder. If you installed Triflare Fx from npm, reinstall it.

**`Packager icons must be PNG files`**

Desktop and packaged app icons must be PNG. Convert the icon or remove `package.icon`.

**The dev server picked a different port**

Port `3000` was in use, so the next free port was used. The address printed in the terminal is the one to open. To make a busy port an error instead, add `--strict-port`.

**The dev server won't start**

Recursive watching needs Node.js 22 or later. Triflare Fx v1 requires Node.js 22, so updating Node.js usually fixes it.

## PenguinMod doesn't look right

If the project opens but some blocks look different:

- Make sure every dropdown value matches PenguinMod's wording exactly. For example, use `"left-right"`, not `"left right"`.
- Check that costume and sound names in blocks match the names in the `costumes:` and `sounds:` declarations.
- A block that ends a script can't have blocks under it. Triflare Fx refuses to build that instead of producing a project PenguinMod can't open.

## Still stuck?

[Open an issue](https://github.com/triflare/fx/issues) and include:

- What you ran.
- The full error message.
- A small `.tfx` file that reproduces the problem, if you can share one.
