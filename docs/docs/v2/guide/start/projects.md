---
title: Projects and fx.yml
description: Folder layout, how fx.yml is found, and every project, fx, vendor, features, and package setting.
---

# Projects and fx.yml

A Triflare Fx project is a folder with source files, assets, and a settings file. This page explains how the folder is organized and what each setting does.

## Folder layout

A new project looks like this:

```text
my-game/
├── fx.yml
├── src/
│   └── main.tfx
├── assets/
│   └── cat.svg
└── build/
    └── my-triflare-fx-project.pmp
```

- `src/` is only a convention. You can keep `.tfx` files anywhere in the project.
- `build/` is created by `fx build` and `fx package`. You don't need to edit it, and you usually don't commit it.
- `assets/` is also a convention. Costume and sound paths are relative to the `.tfx` file that uses them, so any folder works.

Projects that use [vendored extensions](/guide/extensions/vendoring) also have an `extensions/` folder for the copied sources and an `fx.lock` file. Both are committed.

## How fx.yml is found

`fx` looks for `fx.yml` (or `fx.yaml`) in the folder you name, then in each parent folder, and uses the first one it finds. This means you can run `fx build` from inside `src/` and still pick up the project settings at the root.

The `vendor`, `feature`, `sprite`, and legacy `extension` commands look for `fx.yml` in the current folder and its parents. Run them from inside the project.

To build with default settings and ignore `fx.yml`, pass `--no-config`. To use a specific file, pass `--config <file>`.

## The fx.yml file

Here is a complete example with every supported setting:

```yaml
project:
  name: "My Game"
  fps: 60
  width: 480
  height: 360
  turbo: false
  interpolation: true
  hq: false
  runtime:
    maxClones: 300
  extensions: []
  unsandboxed: []

fx:
  partialSprites: false
  vendorDir: extensions
  lint:
    extends: recommended
    rules:
      FX902: off

vendor:
  signals: https://example.com/signals.js
  mything: ./src/mything.js

features:
  temporaryvariables: ./extensions/fx-tempvars.js

package:
  target: html
```

### project

These settings are stored in the PenguinMod project itself.

| Setting         | What it does                                                         | Default               |
| --------------- | -------------------------------------------------------------------- | --------------------- |
| `name`          | The project name. It also names the built file.                      | `Triflare Fx Project` |
| `fps`           | Frames per second. `framerate` is an alias.                          | `30`                  |
| `width`         | Stage width in pixels.                                               | `480`                 |
| `height`        | Stage height in pixels.                                              | `360`                 |
| `turbo`         | Runs scripts as fast as possible instead of at the frame rate.       | `false`               |
| `interpolation` | Smooths motion between frames. `interpolate` is an alias.            | `false`               |
| `hq`            | Turns on the high-quality pen. `hqPen` is an alias.                  | `false`               |
| `runtime`       | Advanced runtime limits. See [Runtime options](#runtime-options).    | See below             |
| `extensions`    | Legacy extension list. Use [`vendor`](#vendor-and-features) instead. | `[]`                  |
| `unsandboxed`   | Extension IDs that are allowed to run unsandboxed.                   | `[]`                  |

### fx

These settings only affect how Triflare Fx builds the project. They are never saved into the PenguinMod project.

| Setting          | What it does                                                                            | Default       |
| ---------------- | --------------------------------------------------------------------------------------- | ------------- |
| `partialSprites` | Allows `partial sprite "Name" { … }` declarations that merge into a sprite.             | `false`       |
| `vendorDir`      | The folder that holds vendored extensions. You can also set it at the top level.        | `extensions`  |
| `lint`           | Lint preset and rule overrides. See [Linting](/guide/workflow/linting#configure-rules). | `recommended` |

See [Split a sprite across files](#split-a-sprite-across-files).

### vendor and features

`vendor` declares extensions whose source is committed to the project, and `features` records the extension files installed by `fx feature`.

| Setting    | What it does                                                               |
| ---------- | -------------------------------------------------------------------------- |
| `vendor`   | Extensions to copy into `vendorDir` and verify against `fx.lock`.          |
| `features` | Extension files installed by `fx feature <name> enable`, keyed by feature. |

Both are optional. Order under `vendor` is load order. See [Vendoring extensions](/guide/extensions/vendoring) and [Project features](/guide/extensions/features).

### package

These settings are used by `fx package` and `fx dev`. They are described in [Building and packaging](/guide/workflow/building).

| Setting                  | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `target`                 | `html` (default), `zip`, `zip-one-asset`, `windows`, `macos`, `linux` |
| `output`                 | Where to write the packaged file                                      |
| `name`                   | Name shown in the packaged app's window and file name                 |
| `version`                | App version for desktop builds                                        |
| `icon`                   | Path to a `.png` icon                                                 |
| `custom`                 | Extra `js`, `css`, or `html` to include in the packaged page          |
| `extract`                | Unzip the output after packaging                                      |
| `fps`, `width`, `height` | Shortcuts for the matching packager options                           |
| `options`                | Any other PenguinMod Packager option                                  |

### Runtime options

`project.runtime` changes PenguinMod's runtime limits. These are advanced settings, and the defaults work for most projects.

| Option       | What it does                                                     | Default |
| ------------ | ---------------------------------------------------------------- | ------- |
| `maxClones`  | The most clones a project can have at once.                      | `300`   |
| `miscLimits` | Keeps the standard limits on things like sound and pen.          | `true`  |
| `fencing`    | Keeps sprites inside the stage when you drag them in the editor. | `true`  |

PenguinMod only stores values that differ from its own defaults. Setting a value back to its default removes it from the project.

## Several source files

A project can use as many `.tfx` files as you like. When you build a folder, `fx`:

- Finds every `.tfx` file under the folder, including subfolders.
- Skips hidden files and folders, plus `node_modules`, `build`, `dist`, `coverage`, and `.cache`.
- Compiles the files in a fixed order, so the same sources always produce the same project.

Across all files, a project can have:

- **One stage.** Put stage code in a `stage { … }` block, or write it at the top level of any file. Both belong to the stage.
- **One sprite declaration per sprite name.** To add to an existing sprite from another file, use a partial sprite.

For example, you can keep the player and the level in separate files:

```text
src/
├── player.tfx
└── level.tfx
```

`src/level.tfx` can hold the stage's backdrop and a script that starts the level, while `src/player.tfx` holds the player sprite.

## Split a sprite across files

Large sprites can be hard to navigate in one file. Turn on partial sprites in `fx.yml`:

```yaml
fx:
  partialSprites: true
```

Then declare the sprite once and add more parts with `partial sprite`:

```tfx
// src/player.tfx
sprite "Player" {
    costumes: {
        idle: "../assets/player.svg"
    };

    let speed = 5;

    when greenFlag {
        control.forever {
            motion.changeX(speed);
        }
    }
}
```

```tfx
// src/player-cheats.tfx
partial sprite "Player" {
    when keyPressed("c") {
        looks.say("Cheats on!");
    }
}
```

The parts are added after the main declaration, in build order. Costume order and variable values stay predictable because the main declaration always comes first.

A partial sprite can also exist on its own, with no regular declaration.

## Assets

Costumes and sounds are declared with a name and a file path:

```tfx
sprite "Cat" {
    costumes: {
        idle: "assets/cat-idle.svg",
        running: "assets/cat-run.png"
    };
    sounds: {
        meow: "assets/meow.wav"
    };
}
```

- The name on the left is what you use in blocks, for example `looks.switchCostume("running")` or `sound.play("meow")`.
- The path is relative to the `.tfx` file that declares it. You can also use an absolute path.
- Supported images are SVG, PNG, JPG, GIF, and BMP. Supported sounds are WAV, MP3, and OGG.
- Each costume's rotation center starts at the center of the image.
- A sprite with no costumes gets a blank 100 × 100 costume. The stage with no backdrops gets a white backdrop the size of the stage.

Assets are copied into the `.pmp` when you build, so the project file doesn't depend on the folders around it.
