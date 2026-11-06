---
title: Building and packaging
description: Build .tfx sources into a .pmp, preview with fx dev, and package a project as HTML, a ZIP, or a desktop app.
---

# Building and packaging

Building turns your `.tfx` files into a PenguinMod project. Packaging turns that project into something you can share: a web page, a ZIP, or a desktop app.

## Build a project

```bash
fx build
```

Run it in a project folder, or name a folder or a single file:

```bash
fx build src/game.tfx
fx build my-game
```

What you get depends on the input:

- **A folder** builds every `.tfx` file under it into `build/<project-name>.pmp`.
- **A file** builds into a `.pmp` next to that file. For example, `src/game.tfx` becomes `src/game.pmp`.

Use `-o` to choose the output path:

```bash
fx build -o dist/game.pmp
```

The build summary lists the sources, sprites and stage, total blocks, assets, and extensions in the project. Open the `.pmp` in [PenguinMod](https://studio.penguinmod.com/) to play it.

To ignore `fx.yml` and build with default settings, add `--no-config`.

## Preview while you work

```bash
fx dev
```

This builds the project, packages it as HTML, and serves it at `http://127.0.0.1:3000/`. It watches the project folder and reloads the page when the build output changes.

If a build fails, the page keeps showing the last good version and adds an error banner. The same error appears in the terminal. Fix the problem and save; the page reloads when the build succeeds.

| Option          | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `--port <port>` | Uses a different port. Default is `3000`.                    |
| `--strict-port` | Fails if the port is taken instead of trying the next one.   |
| `--lan`         | Makes the page available to other devices on your network.   |
| `--host [host]` | Listens on a host. With no value, listens on all interfaces. |

When the server starts, it prints the local address and, for `--lan` or `--host`, the network addresses. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.

## Package a project

```bash
fx package
```

`fx package` builds the project and wraps it in the target you choose. You can also package an existing `.pmp` directly:

```bash
fx package build/game.pmp
```

### Targets

| Target    | What you get                                                                |
| --------- | --------------------------------------------------------------------------- |
| `html`    | A single web page you can open in a browser or upload. This is the default. |
| `zip`     | A ZIP archive of the packaged project.                                      |
| `windows` | A ZIP containing a Windows desktop app built with Electron.                 |
| `macos`   | A ZIP containing a macOS desktop app built with Electron.                   |
| `linux`   | A ZIP containing a Linux desktop app built with Electron.                   |

Choose a target with `--target`:

```bash
fx package --target windows
```

### Choose the output

```bash
fx package -o dist/game.html
```

The default is `build/<name>.<ext>`, where the extension is `.html` for the HTML target and `.zip` for the others.

### Package settings

Set packaging options in `fx.yml` so you don't have to repeat them:

```yaml
package:
  target: html
  name: "My Game"
  version: "1.0.0"
  icon: "assets/icon.png"
  custom:
    css: "src/page.css"
    js: "src/page.js"
    html: "src/footer.html"
```

| Setting                  | What it does                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `target`                 | The packaging target. See [Targets](#targets).                                                                  |
| `output`                 | The output file or folder.                                                                                      |
| `name`                   | The name shown in the app window and used for the output file. Defaults to the project name.                    |
| `version`                | The app version for desktop builds. Default is `1.0.0`.                                                         |
| `icon`                   | A PNG file used as the app icon.                                                                                |
| `custom`                 | Extra CSS, JavaScript, or HTML added to the page.                                                               |
| `extract`                | Unzips the output after packaging.                                                                              |
| `fps`, `width`, `height` | Shortcuts for the packager's frame rate and stage size options.                                                 |
| `options`                | Any other [PenguinMod Packager](https://github.com/PenguinMod/PenguinMod-Packager) option, as a nested mapping. |

The values in `custom` can be inline text or a file reference:

```yaml
package:
  custom:
    css:
      file: "src/page.css"
```

Custom HTML is added just before the page's closing `</body>` tag. Custom CSS and JavaScript are added to the page's head. For ZIP and desktop targets, the same custom HTML is applied to the packaged page.

### Extract the result

Desktop and ZIP targets produce an archive. To unzip it in one step:

```bash
fx package --target windows --extract
```

The archive is extracted into a folder next to it, with the same name. `--extract` only applies to ZIP and desktop targets.

## What packaging downloads

The first time you package, Triflare Fx downloads the PenguinMod runtime. Desktop targets also download an Electron runtime. Both are cached locally, so the first run can take a while and later runs are faster. Nothing is uploaded.
