---
title: The Triflare Fx language
description: Sprites, the stage, variables, lists, events, statements, functions, and expressions in .tfx source files.
---

# The Triflare Fx language

Triflare Fx code looks like JavaScript, but it builds PenguinMod blocks instead of running on its own. A file lists sprites and stage code, and each sprite contains costumes, variables, and scripts.

If you know PenguinMod, you already know most of the concepts. The difference is that you type them.

## Program structure

A file can contain sprite declarations and stage code:

```tfx
let score = 0;

// Code outside a sprite belongs to the stage.
when greenFlag {
    score = 0;
}

sprite "Cat" {
    when greenFlag {
        looks.say("Hello!");
    }
}
```

Code outside a sprite is stage code. You can also group it in a `stage { … }` block if you prefer.

## Comments

Use `//` for a line comment and `/* … */` for a block comment:

```tfx
// The cat turns slowly.
/* This script runs
   when the green flag is clicked. */
```

## Sprites

A sprite starts with its name:

```tfx
sprite "Cat" {
    layer: 1;
    costumes: {
        idle: "../assets/cat.svg"
    };
    sounds: {
        meow: "../assets/meow.wav"
    };

    let score = 0;
}
```

Inside the braces, you can declare:

- **Properties:** `layer`, `costumes`, and `sounds`.
- **Variables and lists.**
- **Functions.**
- **Scripts** that start with `when`.

`layer: 1;` controls which sprite is in front. Higher numbers are closer to the front. Sprites without a `layer` are ordered by how they appear in the project.

No two sprites in a project can share a name. [Projects and fx.yml](/guide/start/projects) explains how to split one sprite across files.

## The stage

The stage holds backdrops, global variables, and scripts that don't belong to a sprite:

```tfx
stage {
    costumes: {
        night: "../assets/night.svg"
    };

    when stageClicked {
        looks.nextBackdrop();
    }
}
```

A project can have only one stage. The `stage { … }` block is optional, so you can write stage code at the top level of any file instead.

## Variables and lists

Declare a variable with `let`:

```tfx
let score = 0;
let playerName = "Ada";
```

Where you declare it decides who can use it:

| Declared in                                          | Who can use it   |
| ---------------------------------------------------- | ---------------- |
| The stage, `stage { … }`, or the top level of a file | Every sprite     |
| A `sprite { … }` block                               | Only that sprite |

Declare a variable once. Duplicate names in the same place are an error.

A variable's starting value must be a plain value, such as a number, text, or `true`. To start from a block's result, declare the variable with a starting value and assign the result in a script:

```tfx
let best = 0;

when greenFlag {
    best = operators.round(score / 10);
}
```

Cloud variables work the same way, but are only allowed at the top level or inside `stage`:

```tfx
cloud let highScore = 0;
```

### Lists

```tfx
list names = ["Ada", "Grace"];
list scores = [];
```

A list declared at the top level or in `stage` is available to every sprite. A list declared in a sprite belongs to that sprite.

Use methods to read and change a list:

| Method                          | What it does                                                      |
| ------------------------------- | ----------------------------------------------------------------- |
| `items.push(value)`             | Adds a value to the end. `add` and `append` also work.            |
| `items.insert(index, value)`    | Adds a value at a position.                                       |
| `items.replace(index, value)`   | Replaces the value at a position. `set` also works.               |
| `items.deleteAt(index)`         | Removes the value at a position. `remove` and `delete` also work. |
| `items.deleteAll()`             | Removes every value. `clear` also works.                          |
| `items.itemAt(index)`           | Returns the value at a position. `at` also works.                 |
| `items.itemNumber(value)`       | Returns the position of a value. `indexOf` also works.            |
| `items.length()`                | Returns the number of values.                                     |
| `items.contains(value)`         | Returns true if the list contains the value.                      |
| `items.show()` / `items.hide()` | Shows or hides the list on the stage.                             |

```tfx
list scores = [10, 20];
let best = 0;

scores.push(30);
best = scores.itemAt(3);
if (scores.contains(20)) {
    looks.say("Still there!");
}
```

Positions start at 1, like PenguinMod list blocks. You can't assign to a list item with `=`; use `replace` instead.

### Temporary variables

With the [Temporary Variables feature](/guide/extensions/features#temporary-variables) enabled, you can declare variables that belong to one thread or one run of the project:

```tfx
thread let hits = 0;
runtime let bestScore = 0;
```

Read and write them with a sigil: `$name` for thread variables, `$$name` for runtime variables.

```tfx
when greenFlag {
    thread let hits = 0;
    $hits += 1;
    $$bestScore = $hits;
    looks.say($$bestScore);
}
```

Thread variables are created inside a script and disappear when that script stops. Runtime variables last until the project stops. Names that start with `$` are reserved, so you can't declare a regular `let`, `list`, or function parameter with one.

## Events

An event starts a script. Every statement must be inside one.

| Event                                    | Starts when                                      |
| ---------------------------------------- | ------------------------------------------------ |
| `when greenFlag { … }`                   | The green flag is clicked.                       |
| `when keyPressed("space") { … }`         | The key is pressed. Use `"any"` for any key.     |
| `when spriteClicked { … }`               | The sprite is clicked.                           |
| `when stageClicked { … }`                | The stage is clicked.                            |
| `when cloneStart { … }`                  | A clone of the sprite is created.                |
| `when broadcast("start") { … }`          | The message `start` is sent.                     |
| `when backdropSwitchesTo("night") { … }` | The stage switches to that backdrop.             |
| `when loudnessGreaterThan(10) { … }`     | The microphone loudness is greater than a value. |
| `when timerGreaterThan(5) { … }`         | The timer is greater than a number of seconds.   |

`when thisSpriteClicked`, `when startAsClone`, and `when broadcastReceived` are aliases for the matching events above.

Send a message with:

```tfx
events.broadcast("start");
events.broadcastAndWait("start");
```

Extensions can add their own events. Use the extension's block name after `when`:

```tfx
when myExtension.onSomething("value") {
    looks.say("It happened!");
}
```

## Statements

### Change a variable

| Statement     | What it does              |
| ------------- | ------------------------- |
| `score = 10;` | Sets the value.           |
| `score += 1;` | Adds to the value.        |
| `score -= 1;` | Subtracts from the value. |
| `score *= 2;` | Multiplies by the value.  |
| `score /= 2;` | Divides by the value.     |

### Call a block

```tfx
motion.moveSteps(10);
looks.say("Hello!");
pen.setColor("#8B5CF6");
```

A block that contains other blocks takes a body:

```tfx
control.forever {
    motion.moveSteps(1);
}
```

Some blocks have an `else` branch:

```tfx
control.ifElse(score > 10) {
    looks.say("You win!");
} else {
    looks.say("Keep going.");
}
```

### Conditions

```tfx
if (score > 10) {
    looks.say("You win!");
} else if (score > 5) {
    looks.say("Almost there!");
} else {
    looks.say("Keep going.");
}
```

Parentheses around the condition are optional.

### Loops

```tfx
repeat (4) {
    motion.moveSteps(10);
    motion.turnRight(90);
}

while (sensing.keyPressed("space")) {
    motion.changeY(1);
}

forever {
    motion.turnRight(1);
}
```

`repeat` runs the body a number of times. `while` repeats as long as the condition is true. `forever` never stops on its own.

### Stop a script

```tfx
control.stop("all");
control.stop("this script");
control.deleteThisClone();
```

`"other scripts in sprite"` stops the sprite's other scripts but lets this one continue.

`return`, `control.stop("all")`, `control.stop("this script")`, and `control.deleteThisClone()` end the script. Nothing can come after them.

## Functions

Functions group code you want to use more than once. They belong to the sprite or stage where you declare them.

```tfx
function jump() {
    motion.setY(motion.yPosition() + 20);
}

returning function mood() {
    if (score > 10) {
        return "happy";
    }
    return "quiet";
}

warp function drawGround() {
    pen.penDown();
    motion.setX(240);
    pen.penUp();
}
```

| Kind                      | What it does                                              |
| ------------------------- | --------------------------------------------------------- |
| `function`                | A command. Call it as a statement.                        |
| `returning function`      | Returns a value. Use it in an expression.                 |
| `warp function`           | Runs without screen refresh, so it finishes in one frame. |
| `returning warp function` | Both of the above. The keywords can be in either order.   |

A command function can be called on its own:

```tfx
jump();
```

A returning function must be used as a value:

```tfx
looks.say(mood());
```

Functions can take arguments:

```tfx
function move(times, distance) {
    repeat (times) {
        motion.moveSteps(distance);
    }
}
```

Add `: boolean` to a parameter to give it a true/false slot:

```tfx
function moveIf(enabled: boolean, distance) {
    if (enabled) {
        motion.moveSteps(distance);
    }
}

moveIf(sensing.keyPressed("space"), 10);
```

`number` and `string` are also accepted as parameter types. They describe the value, but don't change the slot.

Function names must be unique within a sprite or the stage. Functions can be declared in any order, and a function can call one declared later in the file.

## Expressions

Expressions produce values. You can use:

- Numbers: `1`, `2.5`, `1e3`
- Text in single or double quotes: `"hello"`, `'hello'`
- `true` and `false`
- Variables
- Function and block calls
- Parentheses

### Operators

| Operator                | What it does                        |
| ----------------------- | ----------------------------------- |
| `+`, `-`, `*`, `/`, `%` | Arithmetic                          |
| `==`, `!=`              | Equal, not equal                    |
| `<`, `<=`, `>`, `>=`    | Comparisons                         |
| `and`, `&&`             | Both conditions must be true        |
| `or`, `\|\|`            | At least one condition must be true |
| `not`, `!`              | Reverses a condition                |

`and`, `or`, and `not` bind the way you expect: comparisons first, then `not`, then `and`, then `or`. Use parentheses when you want to be explicit.

```tfx
if (score >= 10 and not gameOver) {
    looks.say("Next level!");
}

looks.say(operators.join("Score: ", score));
```

Boolean values become the strings `"true"` and `"false"`, which is what PenguinMod uses for true/false. In a condition, `true` and `false` behave as you expect.

### Colors

Color arguments accept `#rrggbb`, `#rgb`, or `rrggbb`:

```tfx
pen.setColor("#8B5CF6");
pen.setColor("#f00");
```

Any other value becomes black.

## Calling blocks

Every block is written as `category.block(...)`. The names match the block's category in PenguinMod:

```tfx
motion.goToXY(0, 0);
looks.switchCostume("idle");
sensing.askAndWait("What's your name?");
```

Block names are case-sensitive. To see every block you can call, run `fx catalog`. The [Block reference](/guide/language/blocks) explains the naming and lists common blocks.

### Arguments

Arguments go in the order the block reads from left to right. Dropdown choices come first, as text:

```tfx
looks.setEffect("ghost", 50);
sound.setEffect("pitch", 100);
looks.say(operators.math("floor", 4.6));
looks.say(sensing.current("year"));
motion.setRotationStyle("left-right");
control.stop("all");
```

Use the exact text PenguinMod shows in the menu. Some values that look like names are special:

| Use          | For                                             |
| ------------ | ----------------------------------------------- |
| `"_mouse_"`  | The mouse pointer, in motion and sensing blocks |
| `"_random_"` | A random position or sprite                     |
| `"_edge_"`   | The edge of the stage                           |
| `"_myself_"` | The sprite itself, for clones                   |
| `"Stage"`    | The stage, in `sensing.propertyOf`              |

Key names for `sensing.keyPressed` and `when keyPressed` are `"space"`, `"up arrow"`, `"down arrow"`, `"left arrow"`, `"right arrow"`, `"any"`, or a letter such as `"a"`.

Effect names for looks are `"color"`, `"fisheye"`, `"whirl"`, `"pixelate"`, `"mosaic"`, `"brightness"`, and `"ghost"`.

If you leave out an argument, the block's default value is used.

### PenguinMod blocks

A few PenguinMod reporters are in the `pm` category:

```tfx
looks.say(pm.lastKeyPressed());
if (pm.isPenguinMod()) {
    looks.say("Running in PenguinMod!");
}
```

## Rules to remember

- Put statements inside a `when` event. Statements at the top level of a sprite or file are an error.
- Each variable must be declared somewhere in the project. Declarations are collected before scripts are built, so their position in the file doesn't matter.
- One stage per project, and one declaration per sprite name.
- No code after a block that ends a script.
- `[ … ]` is for list contents. It's not a general-purpose array value.
- Returning functions must be used as a value, not called as a statement.

When something is wrong, `fx build` stops at the first problem and shows the file, line, column, and a caret under the code:

```text
CompileError: Unknown variable "scroe"
  --> src/main.tfx:12:9
12 |     scroe += 1;
   |         ^
```

Fix that error, build again, and repeat. `fx check` catches syntax errors faster, but it doesn't check block or variable names; `fx lint` and `fx build` do.
