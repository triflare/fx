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

The output groups blocks by category and shows each block's arguments, such as `motion.moveSteps(STEPS)`. A one-character marker shows the kind: `→` returns a value, `?` is true/false, `▸` is an event, and no marker means a command. To narrow the list, filter by category or name:

```bash
fx catalog --category motion
fx catalog --search glide
```

Run `fx catalog --verbose` to see each block's PenguinMod opcode, kind, and extension. To get the same list as JSON:

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

### PenguinMod-only blocks

PenguinMod adds blocks that Scratch doesn't have. Fx exposes them under the same categories, so they mix freely with the Scratch blocks above. Run `fx catalog` for the complete list.

#### Loop control

`control.escapeLoop()` and `control.continueLoop()` change the innermost loop from inside its body:

```tfx
control.forever {
    if (sensing.keyPressed("space")) {
        control.escapeLoop();       // leave the loop
    }
    if (score < 10) {
        control.continueLoop();     // skip to the next iteration
    }
    score += 1;
}
```

Both blocks end their stack, so no statement can follow them in the same block. The matching PenguinMod opcodes are `control_exitLoop` and `control_continueLoop`.

#### Control

| Block                                               | What it does                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `control.backToGreenFlag()`                         | Stops other scripts and restarts the project as if the flag clicked. |
| `control.continueLoop()`                            | Skips to the next iteration of the innermost loop.                   |
| `control.decrementCounter()`                        | Subtracts one from the runtime counter.                              |
| `control.deleteClonesOf(target)`                    | Deletes every clone of a sprite.                                     |
| `control.escapeLoop()`                              | Leaves the innermost loop.                                           |
| `control.ifReturnElseReturn(condition, then, else)` | Returns one of two values from a custom block.                       |
| `control.javascriptCommand(code)`                   | Runs a snippet of JavaScript.                                        |
| `control.repeatForSeconds(secs) { … }`              | Repeats the body for a duration instead of a count.                  |
| `control.setCounter(value)`                         | Sets the runtime counter.                                            |
| `control.stopSprite(target)`                        | Stops the scripts of a sprite or the stage.                          |
| `control.waitSecondsOrUntil(secs, condition)`       | Waits for a duration or until a condition is true, whichever first.  |
| `control.waitTick()`                                | Waits until the next tick.                                           |

#### Events

| Hat                                       | Starts the script when…                     |
| ----------------------------------------- | ------------------------------------------- |
| `when always { … }`                       | Every tick.                                 |
| `when whenAnything(condition) { … }`      | The condition becomes true.                 |
| `when whenJavaScript(code) { … }`         | A JavaScript expression becomes true.       |
| `when whenKeyHit(key) { … }`              | A key is hit (not while held).              |
| `when whenMouseScrolled(direction) { … }` | The mouse wheel scrolls `"up"` or `"down"`. |
| `when whenStopClicked { … }`              | The stop button is clicked.                 |

#### Data

| Block                                     | What it does                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `data.itemExists(index, list)`            | Returns true if the list has an item at that index.       |
| `data.listAsArray(list)`                  | Returns the list as a JSON array string.                  |
| `data.setListFromArray(list, json)`       | Replaces a list with the items in a JSON array string.    |
| `data.forEachItem(list, variable) { … }`  | Runs the body for every item, assigning it to a variable. |
| `data.forEachIndex(list, variable) { … }` | Runs the body for every index.                            |
| `data.listIsEmpty(list)`                  | Returns true if the list has no items.                    |
| `data.reverseList(list)`                  | Reverses the list in place.                               |

#### Looks

| Block                                                             | What it does                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `looks.effectValue(effect)`                                       | Returns the current value of a graphic effect.                 |
| `looks.isVisible()` / `looks.isSpriteVisible(sprite)`             | Reports whether this sprite or another sprite is visible.      |
| `looks.hideSprite(sprite)` / `looks.showSprite(sprite)`           | Hides or shows another sprite.                                 |
| `looks.changeVisibilityOf(option, sprite)`                        | Changes another sprite's visibility.                           |
| `looks.goToTargetLayer(direction, sprite)`                        | Moves another sprite forwards or backwards through the layers. |
| `looks.layer()` / `looks.setLayer(index)`                         | Reads or sets the layer.                                       |
| `looks.costumeInput(property, costume)`                           | Returns a costume measurement, such as its width or height.    |
| `looks.previousCostume()` / `looks.previousBackdrop()`            | Switches to the previous costume or backdrop.                  |
| `looks.setStretch(x, y)` / `looks.changeStretch(x, y)`            | Sets or changes sprite stretch.                                |
| `looks.stretchX()` / `looks.stretchY()`                           | Returns the stretch on each axis.                              |
| `looks.setTintColor(color)` / `looks.tintColor()`                 | Sets or reads the tint color.                                  |
| `looks.setFont(font, size)` / `looks.setBubbleColor(prop, color)` | Styles speech bubbles.                                         |
| `looks.setTextBubbleShape(prop, value)`                           | Sets a text bubble shape property.                             |
| `looks.sayWidth()` / `looks.sayHeight()`                          | Returns the size of the current speech bubble.                 |
| `looks.stopTalking()`                                             | Closes the current speech bubble.                              |

#### Motion

| Block                                                                                | What it does                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `motion.changeByXY(dx, dy)`                                                          | Moves by separate horizontal and vertical amounts. |
| `motion.pointTowardsXY(x, y)`                                                        | Points toward a position.                          |
| `motion.pointInRandomDirection()`                                                    | Points in a random direction.                      |
| `motion.turnAround()`                                                                | Turns 180 degrees.                                 |
| `motion.turnLeftAroundXY(degrees, x, y)` / `motion.turnRightAroundXY(degrees, x, y)` | Turns around a point.                              |
| `motion.ifOnXYBounce(x, y)` / `motion.ifOnSpriteBounce(sprite)`                      | Bounces off a position or sprite.                  |
| `motion.moveBackSteps(steps)`                                                        | Moves backwards without turning.                   |
| `motion.moveUpDownSteps(direction, steps)`                                           | Moves up or down.                                  |
| `motion.moveToStageSide(side)`                                                       | Snaps to an edge or corner of the stage.           |

#### Operators

| Block                                                                                           | What it does                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `operators.advancedMath(operation, a, b)`                                                       | Uses a PenguinMod math operation.                  |
| `operators.advancedMathExpanded(operation, a, b, c)`                                            | Uses a three-operand math operation.               |
| `operators.advancedLog(value, base)`                                                            | Returns a logarithm with a custom base.            |
| `operators.constrain(value, min, max)`                                                          | Limits a value to a range.                         |
| `operators.javascriptOutput(code)`                                                              | Evaluates JavaScript and returns the result.       |
| `operators.javascriptBoolean(code)`                                                             | Evaluates JavaScript and returns a boolean.        |
| `operators.regexMatch(text, pattern, flags)`                                                    | Returns the matching part of a regular expression. |
| `operators.replaceAll(text, search, replacement)`                                               | Replaces every match.                              |
| `operators.replaceFirst(text, search, replacement)`                                             | Replaces the first match.                          |
| `operators.gte(a, b)` / `operators.lte(a, b)`                                                   | Greater-than-or-equal and less-than-or-equal.      |
| `operators.notEqual(a, b)`                                                                      | Not-equal comparison.                              |
| `operators.indexOf(text, search)` / `operators.lastIndexOf(text, search)`                       | Finds text positions.                              |
| `operators.join3(a, b, c)`                                                                      | Joins three values.                                |
| `operators.lettersBetween(start, end, text)`                                                    | Returns a substring by index.                      |
| `operators.toCase(option, text)`                                                                | Converts text to upper or lower case.              |
| `operators.stringify(value)`                                                                    | Converts a value to text.                          |
| `operators.boolify(value)`                                                                      | Converts a value to a boolean.                     |
| `operators.nand(a, b)` / `operators.nor(a, b)` / `operators.xnor(a, b)` / `operators.xor(a, b)` | Boolean gates.                                     |
| `operators.trueValue()` / `operators.falseValue()` / `operators.randomBoolean()`                | Boolean constants.                                 |

> **Compiler limitation:** PenguinMod's compiled-script mode currently emits invalid JavaScript for `operators.advancedLog` (a missing closing parenthesis in its generated logarithm expression). Until that is fixed in PenguinMod, run projects that use it with the compiler disabled, or use `operators.advancedMath("log", base, value)` as an equivalent expression.

#### Sensing

| Block                                                                            | What it does                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `sensing.distanceBetween(x1, y1, x2, y2)`                                        | Returns the distance between two points.         |
| `sensing.directionBetween(x2, y2, x1, y1)`                                       | Returns the direction between two points.        |
| `sensing.fingerDown(finger)` / `sensing.fingerTapped(finger)`                    | Reads multi-touch input.                         |
| `sensing.fingerX(finger)` / `sensing.fingerY(finger)`                            | Returns a touch position.                        |
| `sensing.mouseScrolling(direction)`                                              | Returns true while the mouse scrolls.            |
| `sensing.mouseClicked()`                                                         | Returns true when the mouse has been clicked.    |
| `sensing.keyHit(key)`                                                            | Returns true when a key is hit rather than held. |
| `sensing.objectTouchingObject(a, b)` / `sensing.objectTouchingClone(a, b)`       | Tests whether two sprites or clones touch.       |
| `sensing.touchingSpritePoint(axis, sprite)`                                      | Returns a touch position on another sprite.      |
| `sensing.distanceTo(object)`                                                     | Returns the distance to an object.               |
| `sensing.clipboard()` / `sensing.setClipboard(text)`                             | Reads or writes the clipboard.                   |
| `sensing.browser()` / `sensing.url()` / `sensing.operatingSystem()`              | Reports the runtime environment.                 |
| `sensing.isMobile()` / `sensing.isDraggable()` / `sensing.loggedIn()`            | Reports browser and project state.               |
| `sensing.isNumber(value)` / `sensing.isText(value)` / `sensing.hasNumber(value)` | Tests value types.                               |
| `sensing.isUpperCase(text)`                                                      | Returns true if text is uppercase.               |
| `sensing.regexTest(text, pattern, flags)`                                        | Tests a regular expression.                      |
| `sensing.spriteWithAttribute(attribute, value)`                                  | Finds a sprite by one of its properties.         |

#### Sound

| Block                               | What it does                             |
| ----------------------------------- | ---------------------------------------- |
| `sound.effectValue(effect)`         | Returns the current sound effect value.  |
| `sound.lengthOf(name)`              | Returns the length of a sound.           |
| `sound.soundVolume(name)`           | Returns the volume of a sound.           |
| `sound.isPlaying(name)`             | Returns true while a sound plays.        |
| `sound.playAt(name, secs)`          | Starts a sound at a position in seconds. |
| `sound.playAtUntilDone(name, secs)` | Starts a sound at a position and waits.  |
| `sound.playAllSounds()`             | Plays every sound at once.               |
| `sound.setFadeOut(secs, name)`      | Fades a sound out over a duration.       |
| `sound.stop(name)`                  | Stops a specific sound.                  |

## Extension blocks

Extension blocks use the extension's ID as the category:

```tfx
myExtension.myBlock(1, "text");
```

Run `fx catalog` after adding an extension to see its exact block names. For more information, see [Extensions](/guide/extensions/extensions).
