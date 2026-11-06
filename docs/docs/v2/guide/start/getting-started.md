---
title: Getting started
description: Take an empty folder to a playable PenguinMod project with fx init, fx build, fx dev, and fx check.
---

# Getting started

This page takes you from an empty folder to a PenguinMod project you can play, in about five minutes.

If you haven't installed Triflare Fx yet, start with [Install Triflare Fx](/guide/start/installation).

## 1. Create a project

Open a terminal and run:

```bash
fx init my-game
cd my-game
```

`fx init` creates a small, working project:

| File             | What it's for                                |
| ---------------- | -------------------------------------------- |
| `fx.yml`         | Project name, stage size, and other settings |
| `src/main.tfx`   | Your Triflare Fx code                        |
| `assets/cat.svg` | A costume used by the sample sprite          |

If a file already exists, `fx init` leaves it alone and tells you it skipped it.

## 2. Read the sample code

Open `src/main.tfx`. It looks like this:

```tfx
sprite "Cat" {
    costumes: {
        cat: "../assets/cat.svg"
    };

    let score = 0;

    when greenFlag {
        motion.goToXY(0, 0);
        control.forever {
            motion.turnRight(1);
        }
    }

    when keyPressed("space") {
        score += 1;
        looks.sayForSecs(operators.join("Score: ", score), 1);
    }
}
```

A few things to notice:

- `sprite "Cat" { … }` declares a sprite. Everything inside it belongs to that sprite.
- `costumes:` lists the sprite's costumes. The path is relative to the `.tfx` file.
- `let score = 0;` creates a variable.
- `when greenFlag` and `when keyPressed("space")` start scripts, like the blocks with a bump on top in PenguinMod.
- `control.forever { … }` repeats the code inside it without stopping.

## 3. Build the project

Run:

```bash
fx build
```

You'll see a summary of what was built:

```text
✓ Built build/my-triflare-fx-project.pmp
  sources:    1 file(s)
  targets:    2
  blocks:     8
  assets:     2
  extensions: (none)
```

The `.pmp` file is a complete PenguinMod project. It contains your code and copies of every costume and sound, so you can move or share the single file.

The name of the file comes from `project.name` in `fx.yml`. A project called `My Game` is built as `build/my-game.pmp`.

## 4. Play it

1. Open [PenguinMod Studio](https://studio.penguinmod.com/).
2. Load `build/my-triflare-fx-project.pmp`.
3. Press the green flag.

The cat turns slowly, and pressing the space bar shows your score.

## 5. Make a change

Edit `src/main.tfx`. For example, change the turn speed:

```tfx
control.forever {
    motion.turnRight(4);
}
```

Build again with `fx build`, then reload the project in PenguinMod to see the change.

While you work, you can skip the manual reload:

```bash
fx dev
```

This builds the project, opens it in your browser at `http://127.0.0.1:3000/`, and reloads the page whenever the build output changes. Build errors appear on the page and in the terminal. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.

To check your code for errors without building:

```bash
fx check
```

## 6. Next steps

- Change the project name, stage size, and frame rate in [Projects and fx.yml](/guide/start/projects).
- Learn about variables, functions, and events in [The Triflare Fx language](/guide/language/syntax).
- Find the block you need in the [Block reference](/guide/language/blocks).
- Share your project as a web page or desktop app with [Building and packaging](/guide/workflow/building).
