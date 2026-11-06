---
title: Install Triflare Fx
description: Install Node.js and the fx command, run it with npx, and add the VS Code extension for .tfx files.
---

# Install Triflare Fx

## What you need

- [Node.js](https://nodejs.org/) 22 or later. To check your version, run `node --version`.
- A PenguinMod project to open the result. You can use [PenguinMod Studio](https://studio.penguinmod.com/) in a browser.

You don't need to install PenguinMod, a compiler, or any other tool.

## Run without installing

You can run the latest version directly with `npx`:

```bash
npx @triflare/fx init my-game
cd my-game
npx @triflare/fx build
```

`npx` downloads the package, runs it, and keeps it in its cache. This is the quickest way to try Triflare Fx.

## Install globally

If you plan to use the `fx` command often, install it once:

```bash
npm install --global @triflare/fx
```

Then check that it's available:

```bash
fx --version
```

You can now run `fx` from any project folder:

```bash
fx init my-game
```

To update an existing installation:

```bash
npm install --global @triflare/fx@latest
```

## Add language support to VS Code

The Triflare Fx repository includes a VS Code extension that adds syntax highlighting and snippets for `.tfx` files. You build and install it yourself.

1. Clone the [Triflare Fx repository](https://github.com/triflare/fx).
2. Open a terminal in the repository's `editors/vscode` folder.
3. Install the extension's dependencies with `npm install`.
4. Build it with `npm run build`.
5. Package it with `npm run package`, which writes a `.vsix` file.
6. In VS Code, open the **Extensions** view, select the **More actions** (…) menu, choose **Install from VSIX…**, and select the generated `.vsix` file.

Without the extension, `.tfx` files are still plain text and every other part of Triflare Fx works the same.

## About downloads

Building a project works offline. Two operations use the network:

- **Packaging** downloads the PenguinMod runtime the first time you run `fx package` or `fx dev`. Desktop targets also download an Electron runtime. Both are cached locally, so later runs are faster.
- **Extensions loaded from a web address** are downloaded when you build, and PenguinMod downloads them again when the project opens.

If your network blocks these downloads, packaging stops with an error. Building a `.pmp` still works.

## Next step

[Build your first project](/guide/start/getting-started).
