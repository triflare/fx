---
title: Sprites
description: Import a sprite archive, export one sprite as a .pms file, and list or remove sprite declarations.
---

# Sprites

A sprite is a source file that declares one or more `sprite` blocks. Triflare Fx can import a sprite from another project and export one as a sprite archive, so you don't have to rebuild every costume and script by hand.

## Import a sprite

Run this from a project folder:

```bash
fx sprite add ./cat.sprite3
```

You can also pass a URL:

```bash
fx sprite add https://example.com/cat.sprite3
```

Triflare Fx reads the archive, writes the sprite's code to a new `.tfx` file in `src/` (for example, `src/cat.tfx`), and copies its costumes and sounds into `assets/`. Paths in the generated source point at those files. The result is normal Triflare Fx code that you can edit like anything else.

Options:

| Option          | What it does                                           |
| --------------- | ------------------------------------------------------ |
| `--name <name>` | Uses a different name for the imported sprite.         |
| `--force`       | Overwrites an existing `.tfx` file with the same name. |

The imported sprite's own name is used by default. If a sprite with that name already exists in the project, the import stops; rename one of them or use `--name`.

Accepted formats are `.sprite3` and `.pms` archives, or a bare `sprite.json` with no costumes or sounds.

## Export a sprite

```bash
fx sprite build "Cat"
```

This compiles the project and writes one sprite to `build/cat.pms`. Use `-o` to choose another path:

```bash
fx sprite build "Cat" -o exports/cat.pms
```

The `.pms` format is the same single-sprite archive Scratch uses for `.sprite3` files, so you can import the result into PenguinMod or another Triflare Fx project.

## List sprites

```bash
fx sprite list
```

The list shows each sprite's name and the files that declare it. To search a different folder, pass it as an argument. For JSON:

```bash
fx sprite list --json
```

## Remove a sprite

```bash
fx sprite remove "Cat"
```

This deletes the source files that declare `Cat`. It only works when those files contain nothing else: no other sprites, stage code, or top-level statements. If a file also holds other code, remove the `sprite "Cat" { … }` block by hand so you don't lose the rest.

## Split a sprite across files

When a sprite grows large, you can move part of it to another file with a partial sprite. Turn the feature on in `fx.yml`:

```yaml
fx:
  partialSprites: true
```

Then add a `partial sprite` block with the same name in another file:

```tfx
partial sprite "Cat" {
    when keyPressed("m") {
        sound.play("meow");
    }
}
```

All parts are merged into one sprite when you build. See [Projects and fx.yml](/guide/start/projects#split-a-sprite-across-files) for details.
