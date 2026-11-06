---
title: Block reference
description: How category.block names map to PenguinMod, plus the motion, looks, sound, control, sensing, operators, pen, and PenguinMod blocks you'll use most.
---

# Block reference

Triflare Fx blocks are the same PenguinMod blocks you know, written as text. This page explains how block names work and lists the blocks you'll use most.

## How block names work

Each block is written as `category.block(...)`:

```tfx
motion.moveSteps(10);
looks.sayForSecs("Hello!", 2);
if (sensing.touching("Cat")) {
    looks.say("Tag, you're it!");
}
```

The category matches the block's color group in PenguinMod. The block name is the action, written in camelCase.

To list every block:

```bash
fx catalog
```

The output shows each block's name, the PenguinMod opcode it becomes, and its kind (`command`, `reporter`, `boolean`, or `hat`). To get the same list as JSON:

```bash
fx catalog --json
```

`fx catalog` also includes blocks from extensions in `fx.yml`, so it's the best way to find an extension block's exact name.

## Common blocks

### Motion

| Block                              | What it does                                              |
| ---------------------------------- | --------------------------------------------------------- |
| `motion.moveSteps(steps)`          | Moves forward or backward.                                |
| `motion.turnRight(degrees)`        | Turns clockwise.                                          |
| `motion.turnLeft(degrees)`         | Turns counterclockwise.                                   |
| `motion.goToXY(x, y)`              | Moves to a position on the stage.                         |
| `motion.glideToXY(secs, x, y)`     | Glides to a position over a number of seconds.            |
| `motion.goTo(target)`              | Moves to the mouse, the edge, or a sprite.                |
| `motion.glideTo(secs, target)`     | Glides to the mouse, the edge, or a sprite.               |
| `motion.pointInDirection(degrees)` | Points in a direction.                                    |
| `motion.pointTowards(target)`      | Points toward the mouse or a sprite.                      |
| `motion.changeX(dx)`               | Moves left or right by an amount.                         |
| `motion.setX(x)`                   | Sets the horizontal position.                             |
| `motion.changeY(dy)`               | Moves up or down by an amount.                            |
| `motion.setY(y)`                   | Sets the vertical position.                               |
| `motion.ifOnEdgeBounce()`          | Bounces off the edge of the stage.                        |
| `motion.setRotationStyle(style)`   | Uses `"all around"`, `"left-right"`, or `"don't rotate"`. |
| `motion.xPosition()`               | Returns the horizontal position.                          |
| `motion.yPosition()`               | Returns the vertical position.                            |
| `motion.direction()`               | Returns the direction.                                    |

### Looks

| Block                                | What it does                         |
| ------------------------------------ | ------------------------------------ |
| `looks.say(message)`                 | Shows a speech bubble.               |
| `looks.sayForSecs(message, secs)`    | Shows a speech bubble for a while.   |
| `looks.think(message)`               | Shows a thought bubble.              |
| `looks.thinkForSecs(message, secs)`  | Shows a thought bubble for a while.  |
| `looks.switchCostume(name)`          | Changes to a costume.                |
| `looks.nextCostume()`                | Changes to the next costume.         |
| `looks.switchBackdrop(name)`         | Changes the backdrop.                |
| `looks.nextBackdrop()`               | Changes to the next backdrop.        |
| `looks.changeSize(amount)`           | Changes the size by a percentage.    |
| `looks.setSize(percent)`             | Sets the size.                       |
| `looks.setEffect(effect, value)`     | Sets a graphic effect.               |
| `looks.changeEffect(effect, amount)` | Changes a graphic effect.            |
| `looks.clearEffects()`               | Removes every graphic effect.        |
| `looks.show()` / `looks.hide()`      | Shows or hides the sprite.           |
| `looks.goToFrontLayer("front")`      | Moves in front of other sprites.     |
| `looks.goToFrontLayer("back")`       | Moves behind other sprites.          |
| `looks.goLayers("forward", 2)`       | Moves forward or backward by layers. |
| `looks.size()`                       | Returns the size.                    |

### Sound

| Block                                | What it does                           |
| ------------------------------------ | -------------------------------------- |
| `sound.play(name)`                   | Plays a sound.                         |
| `sound.playUntilDone(name)`          | Plays a sound and waits for it to end. |
| `sound.stopAllSounds()`              | Stops every sound.                     |
| `sound.setEffect(effect, value)`     | Sets `"pitch"` or `"pan"`.             |
| `sound.changeEffect(effect, amount)` | Changes an effect.                     |
| `sound.clearEffects()`               | Removes sound effects.                 |
| `sound.changeVolume(amount)`         | Changes the volume.                    |
| `sound.setVolume(percent)`           | Sets the volume.                       |
| `sound.volume()`                     | Returns the volume.                    |

### Events

| Block                           | What it does                                         |
| ------------------------------- | ---------------------------------------------------- |
| `events.broadcast(name)`        | Sends a message.                                     |
| `events.broadcastAndWait(name)` | Sends a message and waits for the scripts it starts. |

To start a script when a message arrives, use `when broadcast("name")`. See [Events](/guide/language/syntax#events).

### Control

| Block                                        | What it does                          |
| -------------------------------------------- | ------------------------------------- |
| `control.wait(secs)`                         | Pauses the script.                    |
| `control.repeat(times) { … }`                | Repeats a number of times.            |
| `control.forever { … }`                      | Repeats without stopping.             |
| `control.repeatUntil(condition) { … }`       | Repeats until a condition is true.    |
| `control.if(condition) { … }`                | Runs the body if a condition is true. |
| `control.ifElse(condition) { … } else { … }` | Runs one of two bodies.               |
| `control.waitUntil(condition)`               | Waits until a condition is true.      |
| `control.stop(option)`                       | Stops scripts.                        |
| `control.clone(target)`                      | Creates a clone of a sprite.          |
| `control.deleteThisClone()`                  | Deletes the current clone.            |

`if`, `repeat`, `while`, and `forever` statements are usually easier to read than the block form. See [Statements](/guide/language/syntax#statements).

### Sensing

| Block                                        | What it does                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `sensing.touching(object)`                   | Returns true if the sprite touches the mouse, edge, or a sprite. |
| `sensing.touchingColor(color)`               | Returns true if the sprite touches a color.                      |
| `sensing.colorIsTouchingColor(color, color)` | Returns true if one color touches another.                       |
| `sensing.distanceTo(object)`                 | Returns the distance to the mouse or a sprite.                   |
| `sensing.askAndWait(question)`               | Asks a question and waits for the answer.                        |
| `sensing.answer()`                           | Returns the most recent answer.                                  |
| `sensing.keyPressed(key)`                    | Returns true if a key is pressed.                                |
| `sensing.mouseDown()`                        | Returns true if the mouse button is down.                        |
| `sensing.mouseX()` / `sensing.mouseY()`      | Returns the mouse position.                                      |
| `sensing.timer()`                            | Returns the timer value.                                         |
| `sensing.resetTimer()`                       | Resets the timer.                                                |
| `sensing.propertyOf(property, object)`       | Returns a property of a sprite or the stage.                     |
| `sensing.current(unit)`                      | Returns the current year, month, date, and so on.                |
| `sensing.daysSince2000()`                    | Returns the number of days since 2000.                           |
| `sensing.username()`                         | Returns the user name.                                           |

### Operators

| Block                               | What it does                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `operators.join(text, text)`        | Joins two values into text.                                                 |
| `operators.letterOf(index, text)`   | Returns one character.                                                      |
| `operators.length(text)`            | Returns the length of text.                                                 |
| `operators.contains(text, text)`    | Returns true if the first text contains the second.                         |
| `operators.random(from, to)`        | Returns a random number.                                                    |
| `operators.round(number)`           | Rounds a number.                                                            |
| `operators.math(operation, number)` | Applies a math operation, such as `"abs"`, `"floor"`, `"sqrt"`, or `"sin"`. |

Arithmetic and comparisons are usually written as operators instead: `score + 1`, `score > 10`. See [Expressions](/guide/language/syntax#expressions).

### Pen

The pen is a built-in PenguinMod extension. Using a `pen` block adds the extension to the project automatically.

| Block                                          | What it does                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `pen.clear()`                                  | Erases everything the pen drew.                                      |
| `pen.penDown()` / `pen.penUp()`                | Starts or stops drawing.                                             |
| `pen.stamp()`                                  | Prints the sprite on the stage.                                      |
| `pen.setColor(color)`                          | Sets the pen color.                                                  |
| `pen.setSize(size)` / `pen.changeSize(amount)` | Sets or changes the pen size.                                        |
| `pen.setColorParam(param, value)`              | Sets `"color"`, `"saturation"`, `"brightness"`, or `"transparency"`. |
| `pen.changeColorParam(param, amount)`          | Changes a color parameter.                                           |

### PenguinMod

| Block                 | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `pm.lastKeyPressed()` | Returns the last key that was pressed.            |
| `pm.isCompiled()`     | Returns true if the project is compiled.          |
| `pm.isPenguinMod()`   | Returns true when the project runs in PenguinMod. |

## Extension blocks

Extension blocks use the extension's ID as the category:

```tfx
myExtension.myBlock(1, "text");
```

Run `fx catalog` after adding an extension to see its exact block names. For more information, see [Extensions](/guide/extensions/extensions).
