---
title: Extensions
description: Add PenguinMod extensions to a project with fx extension, call their blocks and events, allow unsandboxed mode, and understand what a build does with them.
---

# Extensions

PenguinMod extensions add new blocks to a project. Triflare Fx can use extensions that follow PenguinMod's extension format, including extensions you write yourself and extensions from a web address.

## Add an extension

From inside a project, run:

```bash
fx extension add ./my-extension.js
```

You can also pass a URL:

```bash
fx extension add https://example.com/my-extension.js
```

This adds the source to `project.extensions` in `fx.yml`. Add several extensions by running the command several times, or edit the list directly:

```yaml
project:
  extensions:
    - ./my-extension.js
    - https://example.com/another-extension.js
```

Order in the list is load order. To see what a project uses:

```bash
fx extension list
```

To remove one, pass the same path or URL, or the extension's ID:

```bash
fx extension remove my-extension.js
```

Both commands look for `fx.yml` in the current folder or a parent folder.

## Use extension blocks

After you add an extension, its blocks appear in `fx catalog` and can be called like any other block:

```tfx
when greenFlag {
    myExtension.myBlock(1, "text");
}
```

The category is the extension's ID, and the block name matches the block's opcode. Use `fx catalog` to find the exact names. Extension events start with `when`:

```tfx
when myExtension.onSomething("value") {
    looks.say("It happened!");
}
```

## Unsandboxed extensions

Some extensions only work when PenguinMod allows them to run unsandboxed. They usually check for this themselves and refuse to load otherwise.

Building a project doesn't block these extensions. When Triflare Fx finds one, the build prints a warning that the extension must be allowed to run unsandboxed when the project opens. In PenguinMod, allow the extension when asked.

If you trust the extension, you can also record the permission. Add it along with the extension, using the extension's ID:

```bash
fx extension add ./my-extension.js --unsandboxed myExtension
```

Or list the ID in `project.unsandboxed`:

```yaml
project:
  unsandboxed:
    - myExtension
```

## What happens during a build

To find an extension's blocks, Triflare Fx runs the extension's setup code in an isolated sandbox and reads the block list it registers. The sandbox has:

- No access to your files, the network, or `process`.
- A 5-second time limit.
- Stand-ins for browser and PenguinMod objects that extensions often touch, so setup code can run without a real project open.

Only the block names and argument types are kept. The extension itself still runs in PenguinMod when the project is played.

Extension files on disk are embedded in the built project, so the `.pmp` doesn't depend on the file being present. Web addresses are stored as addresses, and PenguinMod downloads them when the project opens.

## Limits

- The extension must call `Scratch.extensions.register()` and provide a `getInfo()` with an ID and blocks.
- Boolean, number, angle, and color arguments become the matching input types. Other argument types, such as menus and matrices, are treated as text.
- If a block uses a dropdown, pass the option text as its argument.
- Legacy Scratch 2 (ScratchX) extensions aren't supported.

If an extension fails to load, the build prints a warning with the reason and continues without its blocks. See [Troubleshooting](/reference/troubleshooting#build-warnings).

## Extensions when decompiling

When you [decompile](/guide/workflow/decompiling) a project, Triflare Fx restores its extensions:

- If the project carries the extension's source, it's written to an `extensions/` folder next to the output and added to `project.extensions` in `fx.yml`. If the project has no `fx.yml`, one is created.
- If the project points at a web address, the address is kept in `fx.yml`. Pass `--fetch-extensions` to load it during decompiling; otherwise its blocks become unsupported comments.
