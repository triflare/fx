---
title: Introduction
description: What Triflare Fx is, why to build PenguinMod projects from text, and where each part of the documentation lives.
---

# Introduction

Triflare Fx lets you build PenguinMod projects from text. You write `.tfx` source files in your editor, and the `fx` command compiles them into a `.pmp` project that opens in PenguinMod like any other.

Use Triflare Fx when you want a PenguinMod project that:

- Lives in git, so you can see what changed and undo it.
- Can be searched, diffed, and edited in the tools you already use.
- Can be built and checked automatically.

You can also take an existing `.pmp` project and turn it back into readable source.

## See it in action

Create a sprite with a costume and a script:

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

Build it into a PenguinMod project:

```bash
fx build
```

```text
✓ Built build/my-triflare-fx-project.pmp
  sources:    1 file(s)
  targets:    2
  blocks:     8
  assets:     2
  extensions: (none)
```

Open the `.pmp` file in [PenguinMod](https://studio.penguinmod.com/), then press the green flag.

## Documentation

| If you want to                               | Read                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Install the tools and check your setup       | [Install Triflare Fx](/guide/start/installation)                                |
| Build your first project                     | [Getting started](/guide/start/getting-started)                                 |
| Organize files and change project settings   | [Projects and fx.yml](/guide/start/projects)                                    |
| Learn the language                           | [The Triflare Fx language](/guide/language/syntax)                              |
| Look up a block                              | [Block reference](/guide/language/blocks)                                       |
| Use PenguinMod extensions in a project       | [Extensions](/guide/extensions/extensions)                                      |
| Keep a verified copy of an extension         | [Vendoring extensions](/guide/extensions/vendoring)                             |
| Turn on an extension-backed language feature | [Project features](/guide/extensions/features)                                  |
| Import, export, or split a sprite            | [Sprites](/guide/extensions/sprites)                                            |
| Format and lint your source                  | [Formatting](/guide/workflow/formatting) and [Linting](/guide/workflow/linting) |
| Preview, package, and share your project     | [Building and packaging](/guide/workflow/building)                              |
| Turn an existing `.pmp` into source          | [Decompiling](/guide/workflow/decompiling)                                      |
| Find a command or option                     | [Command reference](/reference/commands)                                        |
| Fix an error or warning                      | [Troubleshooting](/reference/troubleshooting)                                   |

## Get help

If something in this documentation is wrong or missing, or you find a bug in Triflare Fx, [open an issue](https://github.com/triflare/fx/issues). You can also read the [project README](https://github.com/triflare/fx#readme) for a short overview.
