---
title: Decompiling
description: Turn a .pmp or .sb3 project back into readable v1 .tfx source, extract assets, and handle extensions and unsupported blocks.
---

# Decompiling

Decompiling turns a PenguinMod or Scratch project back into Triflare Fx source. Use it to bring an existing project into git, to learn how a project is built, or to edit a project in text instead of blocks.

## Decompile a project

```bash
fx decompile build/game.pmp -o src/game.tfx
```

The input can be any Scratch 3 or PenguinMod archive, including `.pmp` and `.sb3` files. Without `-o`, the source is printed to the terminal instead of written to a file.

The result is regular Triflare Fx code:

- The stage's costumes, variables, and scripts are written at the top of the file.
- Each sprite becomes a `sprite "Name" { … }` block.
- Variables, lists, costumes, sounds, and functions are restored.
- Blocks are written as `category.block(...)` calls.

Build the result with `fx build` to make sure it compiles. Then open the new `.pmp` and compare it with the original.

## Extract costumes and sounds

By default, the decompiled source points at asset names inside the project archive. To save the files next to your source:

```bash
fx decompile build/game.pmp -o src/game.tfx --assets assets/
```

Triflare Fx writes each costume and sound to the assets folder and updates the paths in the source to point at them. File names are based on the content, so the same image keeps the same name across decompiles.

## Extensions

Projects that use extensions decompile with real extension blocks instead of placeholders:

- If the project stores the extension's source, Triflare Fx writes it to an `extensions/` folder next to the output and adds it to `project.extensions` in `fx.yml`. If the project has no `fx.yml`, one is created.
- If the project uses a web address, Triflare Fx keeps the address in `project.extensions` and leaves the extension's blocks as unsupported comments, because it hasn't loaded the extension. Add `--fetch-extensions` to download and load extensions from web addresses during decompiling.

Existing files are never overwritten. If a file with the same name is already in `extensions/`, the archive's copy stays embedded in `fx.yml` instead, and a warning explains what happened.

## Unsupported blocks

If a block has no Triflare Fx equivalent, the decompiler writes a comment in its place:

```tfx
// unsupported block some_extension_doThing
```

The rest of the script still decompiles. Adding the extension to the project with `fx extension add` and decompiling again usually turns these comments into real calls. Comments don't survive a rebuild, so anything still marked unsupported is dropped when you build.

## A typical round trip

```bash
# Start from an existing project.
fx decompile old-game.pmp -o src/old-game.tfx --assets assets/

# Check that the source compiles.
fx build

# Open build/old-game.pmp in PenguinMod and compare.
```

Small differences are normal. For example, the order of scripts on the workspace can change, and a few blocks may become equivalent blocks with the same behavior.
