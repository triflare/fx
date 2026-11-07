---
title: Testing
description: Write project tests in .tfx files and run them with fx test, including actions, state checks, assertions, and reporters.
---

# Testing

Tests check that your project behaves the way you expect without opening PenguinMod. You write them in `.tfx` files next to your code, and `fx test` runs them from the terminal.

## Turn on testing

Testing ships with Fx but starts off. Turn it on once per project:

```bash
fx feature tests enable
```

This adds `tests: true` under `fx:` in `fx.yml`. Run `fx feature tests` to see whether testing is on, and `fx feature tests disable` to turn it off again.

Testing is part of Fx itself, so there is nothing to update. `fx feature tests update` tells you that instead of changing a file.

## Write a test

Tests live in `test/` and end in `.test.tfx`:

```tfx
test "score increases when clicked" {
    reset();
    start();
    step(10);
    click("Player");
    step(1);

    expect state.variable("score") == 1;
    expect state.errors().length == 0;
}
```

A test has a name and a body. The body looks like normal Fx, plus three things: commands that drive the project, `state` checks that read it, and `expect` lines that decide whether the test passes.

Test files are never part of `fx build`, so a test can't end up in the project you publish.

## Drive the project

These commands stand in for playing the project by hand.

| Command                    | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `reset()`                  | Puts the project back the way it was after loading.    |
| `start()`                  | Presses the green flag.                                |
| `step(<n>)`                | Moves time forward by `n` frames. Defaults to one.     |
| `broadcast("name")`        | Sends a broadcast.                                     |
| `broadcastAndWait("name")` | Sends a broadcast and waits for its scripts to finish. |
| `click("Sprite")`          | Clicks a sprite. Without a name, clicks everything.    |
| `keyDown("space")`         | Presses a key.                                         |
| `keyUp("space")`           | Releases a key.                                        |

## Check the project's state

Use `state` to read values the project has produced.

| Check                        | Reads                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| `state.variable("score")`    | A variable's value.                                                |
| `state.list("items").length` | How many items a list has.                                         |
| `state.list("items").items`  | A copy of a list's items.                                          |
| `state.sprite("Player").x`   | A sprite's `x`, `y`, `direction`, `visible`, `size`, or `costume`. |
| `state.broadcasted("Ready")` | Whether the test sent a broadcast.                                 |
| `state.errors()`             | Errors the project reported while the test ran.                    |
| `state.ticks()`              | How many frames the test has stepped through.                      |

## Make assertions

`expect` passes when the expression is true and fails the test when it isn't.

```tfx
expect state.variable("score") == 10;
expect state.list("items").length > 0;
expect state.sprite("Player").visible;
expect state.variable("score") == 10, "score should increase";
```

When a comparison fails, the report shows the value you got, the value you expected, and the line to look at. The optional message at the end replaces the default description.

## Call your own blocks

A test can run the custom blocks you wrote for the project:

```tfx
sprite "Player" {
    let score = 0;

    function resetScore() {
        score = 0;
    }

    returning function points() {
        return score;
    }
}
```

```tfx
test "reset clears the score" {
    start();
    Player.resetScore();
    expect Player.points() == 0;
}
```

Put the sprite name in front of the block so Fx knows which one to run. If only one sprite defines that block, you can leave the name off. A `returning function` gives its value back to the test, so you can use it in `expect` or store it in a variable.

## Settings

The defaults suit most projects. To change them, add them under `fx.tests`:

```yaml
fx:
  tests:
    pattern: "test/**/*.test.tfx"
    seed: 12345
    timeout: 1000
    ticksPerSecond: 30
    failOnRuntimeError: true
    allowProjectExtensions: false
```

| Setting                  | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `pattern`                | Which files count as tests. The default is `test/**/*.test.tfx`. |
| `seed`                   | Fixes randomness so runs repeat exactly.                         |
| `timeout`                | How long one test may take, in milliseconds.                     |
| `ticksPerSecond`         | How many frames one second of project time contains.             |
| `failOnRuntimeError`     | Fails a test when the project reports an error.                  |
| `allowProjectExtensions` | Runs the project's extensions during tests. Off by default.      |

Project extensions are ordinary JavaScript. There is no browser sandbox in a headless run, so loading one runs it in the same Node process as `fx test`, with access to the filesystem and the network. Tests do not load them unless `allowProjectExtensions` is `true`; without that opt-in, `fx test` stops with an error when the project configures extensions, even if no test calls their blocks. Only opt in for extensions you trust.

## Run tests

```bash
fx test
fx test test/score.test.tfx
fx test --filter score
fx test --watch
```

| Option           | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `-t`, `--filter` | Runs only tests whose name or file contains the text. |
| `-w`, `--watch`  | Runs again when you save a `.tfx` or `fx.yml` file.   |
| `--run`          | Runs once and exits. This is the default.             |
| `--reporter`     | `default`, `verbose`, `dot`, `json`, or `junit`.      |
| `--seed`         | Uses a different seed for this run.                   |
| `--timeout`      | Uses a different timeout for this run.                |

The default reporter lists each file and collects failures at the end. `verbose` prints one line per test, `dot` prints one mark per test, `json` is for other tools, and `junit` writes XML for CI. Add `--no-color` for plain text.

`fx test` exits with status 0 when every test passes, 1 when a test fails, 2 when a test file or setting has a problem, and 3 when you stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

## Repeatable runs

Each test starts with the project freshly loaded, and `step` moves time forward without waiting, so a test that passes once keeps passing. Randomness is fixed by `seed`, which is why the same seed is reported with a failure.
