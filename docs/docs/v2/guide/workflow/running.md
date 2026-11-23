---
title: Running
description: Run a project entry point headlessly with fx run, capture run.print output, and configure timeouts.
---

# Running

`fx run` executes project code without opening PenguinMod. Use it to exercise a function, drive a few broadcasts, or check what a script prints. It uses the same headless VM as [testing](/guide/workflow/testing), but it does not assert on the result.

## Turn on running

Running ships with Fx but starts off. Turn it on once per project:

```bash
fx feature run enable
```

This adds `run: true` under `fx:` in `fx.yml`. The `run.*` blocks are only compiled and executed by `fx run`; `fx build` ignores them. Run `fx feature run` to see whether running is on, and `fx feature run disable` to turn it off again.

Running is part of Fx itself, so there is nothing to update. `fx feature run update` tells you that instead of changing a file.

## Write an entry point

Run files live in `run/` and end in `.run.tfx`. Each project has one `main` function:

```tfx
function main() {
    events.broadcast("Thing.do");
}
```

A run file may declare shared variables and helper functions, but not sprites, a stage, tests, or loose statements. Helper-only files are allowed; exactly one file must declare the parameterless `main`.

```tfx
function announce() {
    run.print("starting");
}

function main() {
    announce();
    events.broadcast("Thing.do");
}
```

## Write output and assertions

The `run.*` blocks are ordinary extension blocks, so they can sit anywhere in the project:

```tfx
sprite "Thing" {
    let value = "Thing";
    let name = "";

    when broadcast("Thing.do") {
        value = "Thing 2";
        run.print("Thing done!");
        run.assert(value == "Thing 2", "value did not update");
        run.warn("this run used the fallback path");
        name = run.prompt("Your name?");
        run.print(operators.join("Hello, ", name));
    }
}
```

| Block                            | What it does                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| `run.print(text)`                | Writes a line to standard output.                               |
| `run.warn(text)`                 | Reports a warning without failing the run.                      |
| `run.error(text)`                | Reports an error and fails the run.                             |
| `run.assert(condition, message)` | Fails the run when `condition` is false. `message` is optional. |
| `run.prompt(text)`               | Shows `text` and returns the line the user enters.              |

`fx run` writes prints as they happen and reads prompts from standard input. If standard input is closed, `run.prompt` returns an empty string. `fx build` drops these blocks entirely, so they never reach a published project: they only take effect under `fx run`. `run.error` and a failed `run.assert` stop the run with exit code `1`.

## When a run ends

`main` runs first. `fx run` then keeps stepping the VM until every script that `main` started has finished, so a broadcast handler gets a chance to run. A `forever` loop (or any script that never stops) ends the run when the timeout is reached. Exit codes are `0` for a completed run, `1` when the run fails or times out, `2` for a configuration, parse, build, or project-load problem, and `4` for invalid command options.

## Settings

The defaults suit most projects. To change them, add them under `fx.run`:

```yaml
fx:
  run:
    pattern: "run/**/*.run.tfx"
    seed: 12345
    timeout: 5000
    ticksPerSecond: 30
    failOnRuntimeError: true
```

| Setting              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `pattern`            | Which files count as run files. The default is `run/**/*.run.tfx`. |
| `seed`               | Fixes randomness so runs repeat exactly.                           |
| `timeout`            | How long one run may take, in milliseconds.                        |
| `ticksPerSecond`     | How many frames one second of project time contains.               |
| `failOnRuntimeError` | Fails a run when the project reports an error.                     |

Run files are never part of `fx build`, so an entry point cannot end up in the project you publish.

## Extensions and limitations

Project extensions are ordinary JavaScript, and there is no browser sandbox in a headless run. Loading one runs it in the same Node process as `fx run`, with access to the filesystem and the network. Like `fx test`, `fx run` blocks them unless you opt in with `--allow-project-extensions`. That opt-in is deliberately an invocation option, not an `fx.yml` setting, so a cloned project cannot enable it for you. Without it, `fx run` stops with an error when the project configures extensions, even if the entry point never calls their blocks.

Only opt in after reviewing the extensions in a project you did not write. Trusting a project's extensions means running its code with the same access as the terminal command itself. Network access through `fetch` and `WebSocket` is blocked during a run unless you pass `--allow-external-io`; that guard covers the VM's web APIs, not an extension you chose to trust.

The VM uses a no-op renderer, so a run cannot verify visual behavior: costumes, positions, and drawing calls run, but nothing is drawn and no window opens.

## Run a project

```bash
fx run
fx run run/main.run.tfx
fx run --timeout 10000
fx run --allow-project-extensions
```

| Option                       | What it does                                                  |
| ---------------------------- | ------------------------------------------------------------- |
| `--timeout`                  | Overrides `fx.run.timeout` for this run.                      |
| `--seed`                     | Uses a different seed for this run.                           |
| `--ticks-per-second`         | Overrides the simulated frame rate for this run.              |
| `--allow-project-extensions` | Trusts and loads this project's extensions for this run.      |
| `--allow-external-io`        | Allows network access (`fetch` and `WebSocket`) during a run. |
