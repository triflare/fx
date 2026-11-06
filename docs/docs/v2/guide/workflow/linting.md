---
title: Linting
description: Report source and project problems with fx lint, choose presets and rules, suppress a diagnostic, and apply fixes.
---

# Linting

`fx lint` checks a file, or every `.tfx` file in a directory, plus the merged project. It never changes a file unless you pass `--fix`.

```bash
fx lint
fx lint src/main.tfx
fx lint --strict
fx lint --json
```

Unlike `fx check`, linting resolves variables, functions, assets, and extensions across the whole project, so it reports problems a build would hit before you run one.

## Presets

A preset decides which rules start enabled.

| Preset        | What it includes                                                            |
| ------------- | --------------------------------------------------------------------------- |
| `minimal`     | Rules whose problems stop a build or produce broken blocks.                 |
| `recommended` | The default. Adds undefined names, shadowing, assets, and extension checks. |
| `strict`      | Adds unused declarations, constant conditions, and maintainability rules.   |
| `all`         | Every rule, including future and experimental ones.                         |

Choose a preset with `--preset`, or turn on `--strict`, which uses at least the `strict` preset and also fails the run when it reports warnings.

```bash
fx lint --preset minimal
fx lint --strict
```

## Configure rules

Set a preset and per-rule severities in `fx.yml`:

```yaml
fx:
  lint:
    extends: recommended
    rules:
      FX902: off
      FX208: error
```

`fx.lint.extends` must be one of the preset names. Values in `fx.lint.rules` are `error`, `warn` (`warning` also works), or `off`.

Command-line flags override the file:

```bash
fx lint --rule FX201=off
fx lint --rule FX902=error
fx lint --preset strict
```

`--rule` is repeatable, accepts `=` or `:` before the severity, and a bare rule ID enables it at its default severity. `--strict` raises a weaker configured preset but never downgrades `all`.

## Rules

Rules with a stable ID describe one kind of problem. Severity is the rule's default; it can be overridden.

### Syntax

| Rule    | Severity | Reports                                                 |
| ------- | -------- | ------------------------------------------------------- |
| `FX000` | error    | The source could not be parsed or the project assembled |
| `FX001` | error    | An `fx-lint` comment names a rule that does not exist   |
| `FX002` | warning  | An `fx-lint` comment suppresses nothing                 |

`FX000`, `FX001`, and `FX002` always run and can't be configured.

### Names and scope

| Rule    | Severity | Reports                                                                |
| ------- | -------- | ---------------------------------------------------------------------- |
| `FX201` | error    | Undefined variable                                                     |
| `FX202` | error    | Undefined list                                                         |
| `FX203` | error    | A declaration reads a variable declared later in the same target       |
| `FX204` | error    | Assignment creates an implicit variable (`--fix` adds the declaration) |
| `FX205` | warning  | A local variable shadows a function parameter                          |
| `FX206` | warning  | A sprite variable shadows a project variable                           |
| `FX207` | warning  | Unused function parameter                                              |
| `FX208` | warning  | Unused variable or list                                                |
| `FX209` | warning  | Unused function                                                        |
| `FX211` | warning  | Two declarations differ only by letter case                            |
| `FX212` | error    | `cloud let` outside the stage                                          |
| `FX214` | error    | A declaration uses a reserved `$` temporary-variable name              |

### Control flow

| Rule    | Severity | Reports                                                                           |
| ------- | -------- | --------------------------------------------------------------------------------- |
| `FX101` | error    | A statement follows `return`, `control.stop(...)`, or `control.deleteThisClone()` |
| `FX301` | warning  | Infinite loop with no yielding block                                              |
| `FX302` | warning  | `while` condition is a constant                                                   |
| `FX304` | warning  | `repeat` count is a constant zero or negative                                     |
| `FX307` | error    | `return` outside a function                                                       |
| `FX308` | error    | A `returning function` can finish without a value                                 |
| `FX309` | error    | A value is returned from a non-returning function                                 |
| `FX506` | warning  | A `warp function` contains a yielding block                                       |

### Expressions

| Rule    | Severity | Reports                                       |
| ------- | -------- | --------------------------------------------- |
| `FX403` | warning  | An `if` condition is always truthy or falsy   |
| `FX404` | error    | Division or modulo by a statically known zero |

### Assets, extensions, and project structure

| Rule    | Severity | Reports                                                      |
| ------- | -------- | ------------------------------------------------------------ |
| `FX701` | error    | A costume or sound path does not exist                       |
| `FX702` | warning  | An unsupported or inefficient asset format                   |
| `FX703` | warning  | A file under `assets/` is never referenced                   |
| `FX706` | warning  | A remote extension is not pinned to a verified hash          |
| `FX707` | warning  | A vendored file differs from `fx.lock`                       |
| `FX708` | error    | A declared extension has no vendored file or lock entry      |
| `FX709` | error    | A call does not name a known block, list method, or function |
| `FX803` | error    | `partial sprite` is used without enabling partial sprites    |
| `FX804` | warning  | A partial sprite has no base declaration                     |

### Maintainability

| Rule    | Severity | Reports                                          |
| ------- | -------- | ------------------------------------------------ |
| `FX901` | warning  | Control blocks nested more than four levels deep |
| `FX902` | warning  | A hat or function holds more than 60 statements  |
| `FX908` | warning  | A function has no preceding `//` comment         |

## Suppress a diagnostic

Add an `fx-lint` comment when a diagnostic is intentional. The rule list is optional and can be separated by spaces or commas.

```tfx
// fx-lint-disable-next-line FX208
let unusedButDocumented = 0;
```

| Directive                      | Effect                                        |
| ------------------------------ | --------------------------------------------- |
| `// fx-lint-disable-next-line` | Suppresses diagnostics on the following line. |
| `// fx-lint-disable-file`      | Suppresses diagnostics for the whole file.    |
| `// fx-lint-disable`           | Starts a suppressed range.                    |
| `// fx-lint-enable`            | Ends a suppressed range.                      |

`// fx-lint-disable-next-line FX901` and `// fx-lint-disable FX208, FX902` both work. `--strict` reports suppressions that never matched anything (`FX002`), so stale comments don't pile up.

## Apply fixes

```bash
fx lint --fix
```

`--fix` applies only safe, explicit repairs. Today that means inserting a missing `let` declaration for `FX204`. The remaining rules have no automatic fix, so fix them by hand.

## Exit status

`fx lint` exits with status 1 when it reports errors, or when it reports warnings and you passed `--strict`. It exits with status 0 otherwise. In CI, use `fx lint --strict` to treat warnings as failures.
