---
title: Extensions
description: Add PenguinMod extensions to a project, call their blocks and events, allow unsandboxed mode, and understand what a build does with them.
---

# Extensions

PenguinMod extensions add new blocks to a project. Triflare Fx can use extensions that follow PenguinMod's extension format, including extensions you write yourself and extensions from a web address.

## Add an extension

From inside a project, run:

```bash
fx vendor add ./extensions/my-extension.js
```

You can also pass a URL:

```bash
fx vendor add https://example.com/my-extension.js --as my-extension
```

This copies the extension's source into the project's vendor folder, records its SHA-256 in `fx.lock`, and adds it under `vendor:` in `fx.yml`. Add several extensions by running the command several times, or edit `fx.yml` directly:

```yaml
vendor:
  my-extension: ./extensions/my-extension.js
  another-extension: https://example.com/another-extension.js
```

Order in `vendor:` is load order. Vendoring makes builds reproducible and offline, because the project owns a verified copy of each extension. See [Vendoring extensions](/guide/extensions/vendoring) for the full workflow.

To see what a project uses:

```bash
fx vendor list
```

To remove one:

```bash
fx vendor remove my-extension
```

### Legacy extension commands

Older projects list extensions under `project.extensions` instead. Those entries still build, and the `fx extension add`, `fx extension remove`, and `fx extension list` commands still edit them, but they are deprecated and hidden from help. Run `fx vendor migrate` to move every entry under `vendor:` and write a backup of `fx.yml` first.

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

If you trust the extension, you can also record the permission. Add it along with the extension:

```bash
fx vendor add ./extensions/my-extension.js --unsandboxed
```

Or list its ID in `fx.yml`, either on its vendor entry or in `project.unsandboxed`:

```yaml
vendor:
  my-extension:
    url: ./extensions/my-extension.js
    unsandboxed: true
```

Extensions that don't need unsandboxed mode produce a warning if they're listed there, so you can remove the entry.

## What happens during a build

To find an extension's blocks, Triflare Fx runs the extension's setup code in an isolated sandbox and reads the block list it registers. The sandbox has:

- No access to your files, the network, or `process`.
- A 5-second time limit.
- Stand-ins for browser and PenguinMod objects that extensions often touch, so setup code can run without a real project open.

Only the block names and argument types are kept. The extension itself still runs in PenguinMod when the project is played.

Vendored extension files are embedded in the built project, so the `.pmp` doesn't depend on the file being present. Web addresses that aren't vendored are stored as addresses, and PenguinMod downloads them when the project opens.

## Limits

- The extension must call `Scratch.extensions.register()` and provide a `getInfo()` with an ID and blocks.
- Boolean, number, angle, and color arguments become the matching input types. Other argument types, such as menus and matrices, are treated as text.
- If a block uses a dropdown, pass the option text as its argument.
- Legacy Scratch 2 (ScratchX) extensions aren't supported.

If an extension fails to load, the build prints a warning with the reason and continues without its blocks. See [Troubleshooting](/reference/troubleshooting#build-warnings).

## Extensions when decompiling

When you [decompile](/guide/workflow/decompiling) a project, Triflare Fx restores its extensions:

- If the project carries the extension's source, it's written to an `extensions/` folder and added to `fx.yml`.
- If the project points at a web address, the address is kept in `fx.yml`. Pass `--fetch-extensions` to load it during decompiling; otherwise its blocks become unsupported comments.
