/**
 * Triflare Fx block catalog.
 *
 * The single source of truth for how a `category.function(...)` call maps onto
 * a Scratch/PenguinMod opcode: shape, inputs, dropdown fields and mutations.
 * The compiler, the decompiler and the editor tooling all read from here.
 *
 * Entry conventions:
 *   - `kind` is a command unless the entry says otherwise, so only reporters,
 *     booleans and hats spell it out (see the default applied below).
 *   - `inputs` maps an input name to one of the shared descriptors below.
 *   - `fields` maps a dropdown field name to its default value.
 *   - `args` describes a hat's parameters (`field` or `input`).
 *   - `extension` names the providing extension for non-core opcodes.
 *   - `dynamicNext` / `stopBlock` flag blocks with special stack behaviour.
 *
 * Input descriptors:
 *   NUMBER, STRING, BOOLEAN, ANGLE, COLOR, INTEGER, POSITIVE, WHOLE, SUBSTACK
 *   and BROADCAST are shared `{type}` descriptors;
 *   `{type: 'menu', menu, field, default}` wraps a dropdown shadow block;
 *   `{type: 'variable'|'list'}` takes a variable/list reference.
 */

// Reusable input descriptors -----------------------------------------------
const NUMBER = { type: "number" };
const STRING = { type: "string" };
const BOOLEAN = { type: "boolean" };
const ANGLE = { type: "angle" };
const COLOR = { type: "color" };
const INTEGER = { type: "integer" };
const POSITIVE = { type: "positive" };
const WHOLE = { type: "whole" };
const SUBSTACK = { type: "substack" };
const BROADCAST = { type: "broadcast" };

// Reusable dropdown (shadow menu) descriptors -------------------------------
const GOTO_MENU = {
  type: "menu",
  menu: "motion_goto_menu",
  field: "TO",
  default: "_mouse_",
};
// `motion_glideto` has its own shadow menu block (`motion_glideto_menu`), even
// though it uses the same `TO` field name as `motion_goto_menu`.
const GLIDE_MENU = {
  type: "menu",
  menu: "motion_glideto_menu",
  field: "TO",
  default: "_mouse_",
};
const POINT_MENU = {
  type: "menu",
  menu: "motion_pointtowards_menu",
  field: "TOWARDS",
  default: "_mouse_",
};
const TOUCHING_MENU = {
  type: "menu",
  menu: "sensing_touchingobjectmenu",
  field: "TOUCHINGOBJECTMENU",
  default: "_mouse_",
};
const DISTANCE_MENU = {
  type: "menu",
  menu: "sensing_distancetomenu",
  field: "DISTANCETOMENU",
  default: "_mouse_",
};
const KEY_MENU = {
  type: "menu",
  menu: "sensing_keyoptions",
  field: "KEY_OPTION",
  default: "space",
};
const COSTUME_MENU = {
  type: "menu",
  menu: "looks_costume",
  field: "COSTUME",
  default: "costume1",
};
const BACKDROP_MENU = {
  type: "menu",
  menu: "looks_backdrops",
  field: "BACKDROP",
  default: "backdrop1",
};
const SOUND_MENU = {
  type: "menu",
  menu: "sound_sounds_menu",
  field: "SOUND_MENU",
  default: "pop",
};
const CLONE_MENU = {
  type: "menu",
  menu: "control_create_clone_of_menu",
  field: "CLONE_OPTION",
  default: "_myself_",
};
const OF_MENU = {
  type: "menu",
  menu: "sensing_of_object_menu",
  field: "OBJECT",
  default: "_stage_",
};
const SPRITE_STOP_MENU = {
  type: "menu",
  menu: "control_stop_sprite_menu",
  field: "STOP_OPTION",
  default: "_stage_",
};
const VISIBILITY_MENU = {
  type: "menu",
  menu: "looks_changeVisibilityOfSprite_menu",
  field: "VISIBLE_OPTION",
  default: "_myself_",
};
const OTHER_VISIBILITY_MENU = {
  type: "menu",
  menu: "looks_getOtherSpriteVisible_menu",
  field: "VISIBLE_OPTION",
  default: "_myself_",
};
const COSTUME_INPUT_MENU = {
  type: "menu",
  menu: "looks_getinput_menu",
  field: "INPUT",
  default: "width",
};
const FULL_TOUCHING_MENU = {
  type: "menu",
  menu: "sensing_fulltouchingobjectmenu",
  field: "FULLTOUCHINGOBJECTMENU",
  default: "_mouse_",
};
const SPRITE_TOUCHING_MENU = {
  type: "menu",
  menu: "sensing_touchingobjectmenusprites",
  field: "SPRITETOUCHINGOBJECTMENU",
  default: "_myself_",
};
const SCROLL_MENU = {
  type: "menu",
  menu: "sensing_scrolldirections",
  field: "SCROLL_OPTION",
  default: "up",
};
const FINGER_MENU = {
  type: "menu",
  menu: "sensing_fingeroptions",
  field: "FINGER_OPTION",
  default: "1",
};

// Variable and list references are serialized as *fields*, not inputs, but
// they occupy a positional argument in the Fx call like any other input.
const VAR_REF = { type: "variable" };
const LIST_REF = { type: "list" };

const CORE_CATALOG = {
  // ---------------------------------------------------------------- motion
  "motion.moveSteps": {
    opcode: "motion_movesteps",
    inputs: { STEPS: NUMBER },
  },
  "motion.turnRight": {
    opcode: "motion_turnright",
    inputs: { DEGREES: NUMBER },
  },
  "motion.turnLeft": {
    opcode: "motion_turnleft",
    inputs: { DEGREES: NUMBER },
  },
  "motion.goToXY": {
    opcode: "motion_gotoxy",
    inputs: { X: NUMBER, Y: NUMBER },
  },
  "motion.goTo": {
    opcode: "motion_goto",
    inputs: { TO: GOTO_MENU },
  },
  "motion.glideToXY": {
    opcode: "motion_glidesecstoxy",
    inputs: {
      SECS: NUMBER,
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "motion.glideTo": {
    opcode: "motion_glideto",
    inputs: { SECS: NUMBER, TO: GLIDE_MENU },
  },
  "motion.pointInDirection": {
    opcode: "motion_pointindirection",
    inputs: { DIRECTION: ANGLE },
  },
  "motion.pointTowards": {
    opcode: "motion_pointtowards",
    inputs: { TOWARDS: POINT_MENU },
  },
  "motion.changeX": {
    opcode: "motion_changexby",
    inputs: { DX: NUMBER },
  },
  "motion.setX": {
    opcode: "motion_setx",
    inputs: { X: NUMBER },
  },
  "motion.changeY": {
    opcode: "motion_changeyby",
    inputs: { DY: NUMBER },
  },
  "motion.setY": {
    opcode: "motion_sety",
    inputs: { Y: NUMBER },
  },
  "motion.ifOnEdgeBounce": { opcode: "motion_ifonedgebounce" },
  "motion.setRotationStyle": {
    opcode: "motion_setrotationstyle",
    fields: { STYLE: "all around" },
  },
  "motion.xPosition": { opcode: "motion_xposition", kind: "reporter" },
  "motion.yPosition": { opcode: "motion_yposition", kind: "reporter" },
  "motion.direction": { opcode: "motion_direction", kind: "reporter" },

  // ----------------------------------------------------------------- looks
  "looks.say": {
    opcode: "looks_say",
    inputs: { MESSAGE: STRING },
  },
  "looks.sayForSecs": {
    opcode: "looks_sayforsecs",
    inputs: { MESSAGE: STRING, SECS: NUMBER },
  },
  "looks.think": {
    opcode: "looks_think",
    inputs: { MESSAGE: STRING },
  },
  "looks.thinkForSecs": {
    opcode: "looks_thinkforsecs",
    inputs: { MESSAGE: STRING, SECS: NUMBER },
  },
  "looks.switchCostume": {
    opcode: "looks_switchcostumeto",
    inputs: { COSTUME: COSTUME_MENU },
  },
  "looks.nextCostume": { opcode: "looks_nextcostume" },
  "looks.switchBackdrop": {
    opcode: "looks_switchbackdropto",
    inputs: { BACKDROP: BACKDROP_MENU },
  },
  "looks.switchBackdropAndWait": {
    opcode: "looks_switchbackdroptoandwait",
    inputs: { BACKDROP: BACKDROP_MENU },
  },
  "looks.nextBackdrop": { opcode: "looks_nextbackdrop" },
  "looks.changeSize": {
    opcode: "looks_changesizeby",
    inputs: { CHANGE: NUMBER },
  },
  "looks.setSize": {
    opcode: "looks_setsizeto",
    inputs: { SIZE: NUMBER },
  },
  "looks.changeEffect": {
    opcode: "looks_changeeffectby",
    fields: { EFFECT: "color" },
    inputs: { CHANGE: NUMBER },
  },
  "looks.setEffect": {
    opcode: "looks_seteffectto",
    fields: { EFFECT: "color" },
    inputs: { VALUE: NUMBER },
  },
  "looks.clearEffects": {
    opcode: "looks_cleargraphiceffects",
  },
  "looks.show": { opcode: "looks_show" },
  "looks.hide": { opcode: "looks_hide" },
  "looks.goToFrontLayer": {
    opcode: "looks_gotofrontback",
    fields: { FRONT_BACK: "front" },
  },
  "looks.goLayers": {
    opcode: "looks_goforwardbackwardlayers",
    fields: { FORWARD_BACKWARD: "forward" },
    inputs: { NUM: INTEGER },
  },
  "looks.costumeNumber": {
    opcode: "looks_costumenumbername",
    kind: "reporter",
    fields: { NUMBER_NAME: "number" },
  },
  "looks.backdropNumber": {
    opcode: "looks_backdropnumbername",
    kind: "reporter",
    fields: { NUMBER_NAME: "number" },
  },
  "looks.size": { opcode: "looks_size", kind: "reporter" },

  // ----------------------------------------------------------------- sound
  "sound.play": {
    opcode: "sound_play",
    inputs: { SOUND_MENU: SOUND_MENU },
  },
  "sound.playUntilDone": {
    opcode: "sound_playuntildone",
    inputs: { SOUND_MENU: SOUND_MENU },
  },
  "sound.stopAllSounds": { opcode: "sound_stopallsounds" },
  "sound.changeEffect": {
    opcode: "sound_changeeffectby",
    fields: { EFFECT: "pitch" },
    inputs: { VALUE: NUMBER },
  },
  "sound.setEffect": {
    opcode: "sound_seteffectto",
    fields: { EFFECT: "pitch" },
    inputs: { VALUE: NUMBER },
  },
  "sound.clearEffects": { opcode: "sound_cleareffects" },
  "sound.changeVolume": {
    opcode: "sound_changevolumeby",
    inputs: { VOLUME: NUMBER },
  },
  "sound.setVolume": {
    opcode: "sound_setvolumeto",
    inputs: { VOLUME: NUMBER },
  },
  "sound.volume": { opcode: "sound_volume", kind: "reporter" },

  // --------------------------------------------------------------- sensing
  "sensing.touching": {
    opcode: "sensing_touchingobject",
    kind: "boolean",
    inputs: { TOUCHINGOBJECTMENU: TOUCHING_MENU },
  },
  "sensing.touchingColor": {
    opcode: "sensing_touchingcolor",
    kind: "boolean",
    inputs: { COLOR: COLOR },
  },
  "sensing.colorIsTouchingColor": {
    opcode: "sensing_coloristouchingcolor",
    kind: "boolean",
    inputs: { COLOR: COLOR, COLOR2: COLOR },
  },
  "sensing.distanceTo": {
    opcode: "sensing_distanceto",
    kind: "reporter",
    inputs: { DISTANCETOMENU: DISTANCE_MENU },
  },
  "sensing.askAndWait": {
    opcode: "sensing_askandwait",
    inputs: { QUESTION: STRING },
  },
  "sensing.answer": { opcode: "sensing_answer", kind: "reporter" },
  "sensing.keyPressed": {
    opcode: "sensing_keypressed",
    kind: "boolean",
    inputs: { KEY_OPTION: KEY_MENU },
  },
  "sensing.mouseDown": { opcode: "sensing_mousedown", kind: "boolean" },
  "sensing.mouseX": { opcode: "sensing_mousex", kind: "reporter" },
  "sensing.mouseY": { opcode: "sensing_mousey", kind: "reporter" },
  "sensing.loudness": { opcode: "sensing_loudness", kind: "reporter" },
  "sensing.timer": { opcode: "sensing_timer", kind: "reporter" },
  "sensing.resetTimer": { opcode: "sensing_resettimer" },
  "sensing.propertyOf": {
    opcode: "sensing_of",
    kind: "reporter",
    fields: { PROPERTY: "x position" },
    inputs: { OBJECT: OF_MENU },
  },
  "sensing.current": {
    opcode: "sensing_current",
    kind: "reporter",
    fields: { CURRENTMENU: "year" },
  },
  "sensing.daysSince2000": {
    opcode: "sensing_dayssince2000",
    kind: "reporter",
  },
  "sensing.username": { opcode: "sensing_username", kind: "reporter" },

  // ------------------------------------------------------------- operators
  "operators.add": {
    opcode: "operator_add",
    kind: "reporter",
    inputs: { NUM1: NUMBER, NUM2: NUMBER },
  },
  "operators.subtract": {
    opcode: "operator_subtract",
    kind: "reporter",
    inputs: { NUM1: NUMBER, NUM2: NUMBER },
  },
  "operators.multiply": {
    opcode: "operator_multiply",
    kind: "reporter",
    inputs: { NUM1: NUMBER, NUM2: NUMBER },
  },
  "operators.divide": {
    opcode: "operator_divide",
    kind: "reporter",
    inputs: { NUM1: NUMBER, NUM2: NUMBER },
  },
  "operators.random": {
    opcode: "operator_random",
    kind: "reporter",
    inputs: { FROM: NUMBER, TO: NUMBER },
  },
  "operators.gt": {
    opcode: "operator_gt",
    kind: "boolean",
    inputs: { OPERAND1: STRING, OPERAND2: STRING },
  },
  "operators.lt": {
    opcode: "operator_lt",
    kind: "boolean",
    inputs: { OPERAND1: STRING, OPERAND2: STRING },
  },
  "operators.equals": {
    opcode: "operator_equals",
    kind: "boolean",
    inputs: { OPERAND1: STRING, OPERAND2: STRING },
  },
  "operators.and": {
    opcode: "operator_and",
    kind: "boolean",
    inputs: { OPERAND1: BOOLEAN, OPERAND2: BOOLEAN },
  },
  "operators.or": {
    opcode: "operator_or",
    kind: "boolean",
    inputs: { OPERAND1: BOOLEAN, OPERAND2: BOOLEAN },
  },
  "operators.not": {
    opcode: "operator_not",
    kind: "boolean",
    inputs: { OPERAND: BOOLEAN },
  },
  "operators.join": {
    opcode: "operator_join",
    kind: "reporter",
    inputs: { STRING1: STRING, STRING2: STRING },
  },
  "operators.letterOf": {
    opcode: "operator_letter_of",
    kind: "reporter",
    inputs: { LETTER: NUMBER, STRING: STRING },
  },
  "operators.length": {
    opcode: "operator_length",
    kind: "reporter",
    inputs: { STRING: STRING },
  },
  "operators.contains": {
    opcode: "operator_contains",
    kind: "boolean",
    inputs: { STRING1: STRING, STRING2: STRING },
  },
  "operators.mod": {
    opcode: "operator_mod",
    kind: "reporter",
    inputs: { NUM1: NUMBER, NUM2: NUMBER },
  },
  "operators.round": {
    opcode: "operator_round",
    kind: "reporter",
    inputs: { NUM: NUMBER },
  },
  "operators.math": {
    opcode: "operator_mathop",
    kind: "reporter",
    fields: { OPERATOR: "abs" },
    inputs: { NUM: NUMBER },
  },

  // --------------------------------------------------------------- control
  "control.wait": {
    opcode: "control_wait",
    inputs: { DURATION: POSITIVE },
  },
  "control.repeat": {
    opcode: "control_repeat",
    inputs: { TIMES: WHOLE, SUBSTACK: SUBSTACK },
  },
  "control.forever": {
    opcode: "control_forever",
    inputs: { SUBSTACK: SUBSTACK },
    // PenguinMod builds this loop without a next-statement connection and only
    // creates one from the block's mutation (`hasbreak` — the nub the editor
    // adds by itself once a block sits below the loop). Blocks stacked under a
    // `control.forever` therefore need that mutation: without it the editor's
    // XML loader dereferences the missing connection while reading the
    // following `<next>` element and the whole workspace update fails.
    dynamicNext: true,
  },
  "control.if": {
    opcode: "control_if",
    inputs: { CONDITION: BOOLEAN, SUBSTACK: SUBSTACK },
  },
  "control.ifElse": {
    opcode: "control_if_else",
    inputs: {
      CONDITION: BOOLEAN,
      SUBSTACK: SUBSTACK,
      SUBSTACK2: SUBSTACK,
    },
  },
  "control.waitUntil": {
    opcode: "control_wait_until",
    inputs: { CONDITION: BOOLEAN },
  },
  "control.repeatUntil": {
    opcode: "control_repeat_until",
    inputs: { CONDITION: BOOLEAN, SUBSTACK: SUBSTACK },
  },
  "control.stop": {
    opcode: "control_stop",
    fields: { STOP_OPTION: "all" },
    stopBlock: true,
  },
  "control.clone": {
    opcode: "control_create_clone_of",
    inputs: { CLONE_OPTION: CLONE_MENU },
  },
  "control.deleteThisClone": {
    opcode: "control_delete_this_clone",
  },

  // ---------------------------------------------------------------- events
  "events.broadcast": {
    opcode: "event_broadcast",
    inputs: { BROADCAST_INPUT: BROADCAST },
  },
  "events.broadcastAndWait": {
    opcode: "event_broadcastandwait",
    inputs: { BROADCAST_INPUT: BROADCAST },
  },

  // --------------------------------------------------------------- hats
  "events.greenFlag": {
    opcode: "event_whenflagclicked",
    kind: "hat",
    args: [],
  },
  "events.keyPressed": {
    opcode: "event_whenkeypressed",
    kind: "hat",
    args: [{ field: "KEY_OPTION", default: "space" }],
  },
  "events.spriteClicked": {
    opcode: "event_whenthisspriteclicked",
    kind: "hat",
    args: [],
  },
  "events.stageClicked": {
    opcode: "event_whenstageclicked",
    kind: "hat",
    args: [],
  },
  "events.cloneStart": {
    opcode: "control_start_as_clone",
    kind: "hat",
    args: [],
  },
  "events.broadcastReceived": {
    opcode: "event_whenbroadcastreceived",
    kind: "hat",
    args: [{ field: "BROADCAST_OPTION", type: "broadcast" }],
  },
  "events.backdropSwitchesTo": {
    opcode: "event_whenbackdropswitchesto",
    kind: "hat",
    args: [{ field: "BACKDROP", default: "backdrop1" }],
  },
  // The dropdown field is `WHENGREATERTHANMENU` in TurboWarp/PenguinMod (the
  // vanilla Scratch 3 name is `WHENGREATER`); the option values are the
  // uppercase menu ids `LOUDNESS`/`TIMER`. See PenguinMod-Blocks event.js and
  // scratch3_event.js.
  "events.loudnessGreaterThan": {
    opcode: "event_whengreaterthan",
    kind: "hat",
    args: [
      { input: "VALUE", type: "number" },
      { field: "WHENGREATERTHANMENU", value: "LOUDNESS" },
    ],
  },
  "events.timerGreaterThan": {
    opcode: "event_whengreaterthan",
    kind: "hat",
    args: [
      { input: "VALUE", type: "number" },
      { field: "WHENGREATERTHANMENU", value: "TIMER" },
    ],
  },

  // ------------------------------------------------------------------ pen
  "pen.clear": { opcode: "pen_clear", extension: "pen" },
  "pen.stamp": { opcode: "pen_stamp", extension: "pen" },
  "pen.penDown": { opcode: "pen_penDown", extension: "pen" },
  "pen.penUp": { opcode: "pen_penUp", extension: "pen" },
  "pen.setColor": {
    opcode: "pen_setPenColorToColor",
    inputs: { COLOR: COLOR },
    extension: "pen",
  },
  "pen.changeSize": {
    opcode: "pen_changePenSizeBy",
    inputs: { SIZE: NUMBER },
    extension: "pen",
  },
  "pen.setSize": {
    opcode: "pen_setPenSizeTo",
    inputs: { SIZE: NUMBER },
    extension: "pen",
  },
  // COLOR_PARAM is an input whose shadow is `pen_menu_colorParam`, not a
  // direct field: the pen extension declares `colorParam` with
  // `acceptReporters: true`, so the workspace serializes it as a value input
  // wrapping a shadow menu block (field name `colorParam`).
  "pen.changeColorParam": {
    opcode: "pen_changePenColorParamBy",
    inputs: {
      COLOR_PARAM: {
        type: "menu",
        menu: "pen_menu_colorParam",
        field: "colorParam",
        default: "color",
      },
      VALUE: NUMBER,
    },
    extension: "pen",
  },
  "pen.setColorParam": {
    opcode: "pen_setPenColorParamTo",
    inputs: {
      COLOR_PARAM: {
        type: "menu",
        menu: "pen_menu_colorParam",
        field: "colorParam",
        default: "color",
      },
      VALUE: NUMBER,
    },
    extension: "pen",
  },

  // ------------------------------------------------------------ penguinmod
  "pm.lastKeyPressed": {
    opcode: "argument_reporter_string_number",
    kind: "reporter",
    fields: { VALUE: ["last key pressed", null] },
  },
  "pm.isCompiled": {
    opcode: "argument_reporter_boolean",
    kind: "boolean",
    fields: { VALUE: ["is compiled?", null] },
  },
  "pm.isPenguinMod": {
    opcode: "argument_reporter_boolean",
    kind: "boolean",
    fields: { VALUE: ["is penguinmod?", null] },
  },

  // ------------------------------------------------- temporary variables
  // The Fx fork of Temporary Variables (`fxTempVars`). Entries are marked
  // `requiresExtension` so the compiler can refuse to emit blocks whose
  // extension is not loaded, and so the linter can point at the feature.
  "tempvars.setThread": {
    opcode: "fxTempVars_setThreadVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: {
      VAR: { type: "string", default: "variable" },
      STRING: { type: "string", default: "0" },
    },
  },
  "tempvars.changeThread": {
    opcode: "fxTempVars_changeThreadVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: {
      VAR: { type: "string", default: "variable" },
      NUM: { type: "number", default: "1" },
    },
  },
  "tempvars.thread": {
    opcode: "fxTempVars_getThreadVariable",
    kind: "reporter",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: { VAR: { type: "string", default: "variable" } },
  },
  "tempvars.threadExists": {
    opcode: "fxTempVars_threadVariableExists",
    kind: "boolean",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: { VAR: { type: "string", default: "variable" } },
  },
  "tempvars.forEachThread": {
    opcode: "fxTempVars_forEachThreadVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: {
      VAR: { type: "string", default: "thread variable" },
      NUM: { type: "number", default: "10" },
      SUBSTACK: SUBSTACK,
    },
  },
  "tempvars.threads": {
    opcode: "fxTempVars_listThreadVariables",
    kind: "reporter",
    extension: "fxTempVars",
    requiresExtension: true,
  },
  "tempvars.setRuntime": {
    opcode: "fxTempVars_setRuntimeVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: {
      VAR: { type: "string", default: "variable" },
      STRING: { type: "string", default: "0" },
    },
  },
  "tempvars.changeRuntime": {
    opcode: "fxTempVars_changeRuntimeVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: {
      VAR: { type: "string", default: "variable" },
      // Upstream declares NUM as a string input; keep it so block JSON matches.
      NUM: { type: "string", default: "1" },
    },
  },
  "tempvars.runtime": {
    opcode: "fxTempVars_getRuntimeVariable",
    kind: "reporter",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: { VAR: { type: "string", default: "variable" } },
  },
  "tempvars.runtimeExists": {
    opcode: "fxTempVars_runtimeVariableExists",
    kind: "boolean",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: { VAR: { type: "string", default: "variable" } },
  },
  "tempvars.deleteRuntime": {
    opcode: "fxTempVars_deleteRuntimeVariable",
    extension: "fxTempVars",
    requiresExtension: true,
    inputs: { VAR: { type: "string", default: "variable" } },
  },
  "tempvars.deleteAllRuntime": {
    opcode: "fxTempVars_deleteAllRuntimeVariables",
    extension: "fxTempVars",
    requiresExtension: true,
  },
  "tempvars.runtimes": {
    opcode: "fxTempVars_listRuntimeVariables",
    kind: "reporter",
    extension: "fxTempVars",
    requiresExtension: true,
  },
  // ---- control (PenguinMod) --------------------------------------------
  "control.backToGreenFlag": {
    opcode: "control_backToGreenFlag",
  },
  "control.continueLoop": {
    opcode: "control_continueLoop",
  },
  "control.decrementCounter": {
    opcode: "control_decr_counter",
  },
  "control.deleteClonesOf": {
    opcode: "control_delete_clones_of",
    inputs: {
      CLONE_OPTION: CLONE_MENU,
    },
  },
  "control.escapeLoop": {
    opcode: "control_exitLoop",
  },
  "control.ifReturnElseReturn": {
    opcode: "control_if_return_else_return",
    kind: "reporter",
    inputs: {
      boolean: BOOLEAN,
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "control.javascriptCommand": {
    opcode: "control_javascript_command",
    inputs: {
      JS: STRING,
    },
  },
  "control.repeatForSeconds": {
    opcode: "control_repeatForSeconds",
    inputs: {
      TIMES: POSITIVE,
      SUBSTACK: SUBSTACK,
    },
  },
  "control.setCounter": {
    opcode: "control_set_counter",
    inputs: {
      VALUE: NUMBER,
    },
  },
  "control.stopSprite": {
    opcode: "control_stop_sprite",
    inputs: {
      STOP_OPTION: SPRITE_STOP_MENU,
    },
  },
  "control.waitSecondsOrUntil": {
    opcode: "control_waitsecondsoruntil",
    inputs: {
      DURATION: POSITIVE,
      CONDITION: BOOLEAN,
    },
  },
  "control.waitTick": {
    opcode: "control_waittick",
  },

  // ---- data (PenguinMod) --------------------------------------------
  "data.setListFromArray": {
    opcode: "data_arraylist",
    inputs: {
      LIST: LIST_REF,
      VALUE: STRING,
    },
  },
  "data.itemExists": {
    opcode: "data_itemexistslist",
    kind: "boolean",
    inputs: {
      INDEX: WHOLE,
      LIST: LIST_REF,
    },
  },
  "data.listAsArray": {
    opcode: "data_listarray",
    kind: "reporter",
    inputs: {
      LIST: LIST_REF,
    },
  },
  "data.forEachItem": {
    opcode: "data_listforeachitem",
    inputs: {
      LIST: LIST_REF,
      VARIABLE: VAR_REF,
      SUBSTACK: SUBSTACK,
    },
  },
  "data.forEachIndex": {
    opcode: "data_listforeachnum",
    inputs: {
      LIST: LIST_REF,
      VARIABLE: VAR_REF,
      SUBSTACK: SUBSTACK,
    },
  },
  "data.listIsEmpty": {
    opcode: "data_listisempty",
    kind: "boolean",
    inputs: {
      LIST: LIST_REF,
    },
  },
  "data.reverseList": {
    opcode: "data_reverselist",
    inputs: {
      LIST: LIST_REF,
    },
  },

  // ---- events (PenguinMod) --------------------------------------------
  "events.always": {
    opcode: "event_always",
    kind: "hat",
    args: [],
  },
  "events.whenAnything": {
    opcode: "event_whenanything",
    kind: "hat",
    args: [{ input: "ANYTHING", type: "boolean" }],
  },
  "events.whenJavaScript": {
    opcode: "event_whenjavascript",
    kind: "hat",
    args: [{ input: "JS", type: "string" }],
  },
  "events.whenKeyHit": {
    opcode: "event_whenkeyhit",
    kind: "hat",
    args: [{ field: "KEY_OPTION", default: "space" }],
  },
  "events.whenMouseScrolled": {
    opcode: "event_whenmousescrolled",
    kind: "hat",
    args: [{ field: "KEY_OPTION", default: "up" }],
  },
  "events.whenStopClicked": {
    opcode: "event_whenstopclicked",
    kind: "hat",
    args: [],
  },

  // ---- looks (PenguinMod) --------------------------------------------
  "looks.changeStretch": {
    opcode: "looks_changeStretch",
    inputs: {
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "looks.changeVisibilityOf": {
    opcode: "looks_changeVisibilityOfSprite",
    fields: { VISIBLE_TYPE: "show" },
    inputs: {
      VISIBLE_OPTION: VISIBILITY_MENU,
    },
  },
  "looks.hideSprite": {
    opcode: "looks_changeVisibilityOfSpriteHide",
    inputs: {
      VISIBLE_OPTION: VISIBILITY_MENU,
    },
  },
  "looks.showSprite": {
    opcode: "looks_changeVisibilityOfSpriteShow",
    inputs: {
      VISIBLE_OPTION: VISIBILITY_MENU,
    },
  },
  "looks.effectValue": {
    opcode: "looks_getEffectValue",
    kind: "reporter",
    fields: { EFFECT: "COLOR" },
  },
  "looks.isSpriteVisible": {
    opcode: "looks_getOtherSpriteVisible",
    kind: "boolean",
    inputs: {
      VISIBLE_OPTION: OTHER_VISIBILITY_MENU,
    },
  },
  "looks.isVisible": {
    opcode: "looks_getSpriteVisible",
    kind: "boolean",
  },
  "looks.costumeInput": {
    opcode: "looks_getinputofcostume",
    kind: "reporter",
    inputs: {
      INPUT: COSTUME_INPUT_MENU,
      COSTUME: COSTUME_MENU,
    },
  },
  "looks.goToTargetLayer": {
    opcode: "looks_goTargetLayer",
    fields: { FORWARD_BACKWARD: "infront" },
    inputs: {
      VISIBLE_OPTION: OTHER_VISIBILITY_MENU,
    },
  },
  "looks.layer": {
    opcode: "looks_layersGetLayer",
    kind: "reporter",
  },
  "looks.setLayer": {
    opcode: "looks_layersSetLayer",
    inputs: {
      NUM: INTEGER,
    },
  },
  "looks.previousBackdrop": {
    opcode: "looks_previousbackdrop",
  },
  "looks.previousCostume": {
    opcode: "looks_previouscostume",
  },
  "looks.sayHeight": {
    opcode: "looks_sayHeight",
    kind: "reporter",
  },
  "looks.sayWidth": {
    opcode: "looks_sayWidth",
    kind: "reporter",
  },
  "looks.setBubbleColor": {
    opcode: "looks_setColor",
    fields: { prop: "BUBBLE_STROKE" },
    inputs: {
      color: COLOR,
    },
  },
  "looks.setFont": {
    opcode: "looks_setFont",
    inputs: {
      font: { type: "string", default: "Helvetica" },
      size: { type: "number", default: "14" },
    },
  },
  "looks.setTextBubbleShape": {
    opcode: "looks_setShape",
    fields: { prop: "MIN_WIDTH" },
    inputs: {
      color: NUMBER,
    },
  },
  "looks.setStretch": {
    opcode: "looks_setStretch",
    inputs: {
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "looks.setTintColor": {
    opcode: "looks_setTintColor",
    inputs: {
      color: COLOR,
    },
  },
  "looks.stopTalking": {
    opcode: "looks_stoptalking",
  },
  "looks.stretchX": {
    opcode: "looks_stretchGetX",
    kind: "reporter",
  },
  "looks.stretchY": {
    opcode: "looks_stretchGetY",
    kind: "reporter",
  },
  "looks.tintColor": {
    opcode: "looks_tintColor",
    kind: "reporter",
  },

  // ---- motion (PenguinMod) --------------------------------------------
  "motion.changeByXY": {
    opcode: "motion_changebyxy",
    inputs: {
      DX: NUMBER,
      DY: NUMBER,
    },
  },
  "motion.ifOnSpriteBounce": {
    opcode: "motion_ifonspritebounce",
    inputs: {
      SPRITE: POINT_MENU,
    },
  },
  "motion.ifOnXYBounce": {
    opcode: "motion_ifonxybounce",
    inputs: {
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "motion.moveToStageSide": {
    opcode: "motion_move_sprite_to_scene_side",
    fields: { ALIGNMENT: "bottom-left" },
  },
  "motion.moveBackSteps": {
    opcode: "motion_movebacksteps",
    inputs: {
      STEPS: NUMBER,
    },
  },
  "motion.moveUpDownSteps": {
    opcode: "motion_moveupdownsteps",
    fields: { DIRECTION: "up" },
    inputs: {
      STEPS: NUMBER,
    },
  },
  "motion.pointInRandomDirection": {
    opcode: "motion_pointinrandomdirection",
  },
  "motion.pointTowardsXY": {
    opcode: "motion_pointtowardsxy",
    inputs: {
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "motion.turnAround": {
    opcode: "motion_turnaround",
  },
  "motion.turnLeftAroundXY": {
    opcode: "motion_turnleftaroundxy",
    inputs: {
      DEGREES: NUMBER,
      X: NUMBER,
      Y: NUMBER,
    },
  },
  "motion.turnRightAroundXY": {
    opcode: "motion_turnrightaroundxy",
    inputs: {
      DEGREES: NUMBER,
      X: NUMBER,
      Y: NUMBER,
    },
  },

  // ---- operators (PenguinMod) --------------------------------------------
  "operators.advancedMath": {
    opcode: "operator_advMath",
    kind: "reporter",
    fields: { OPTION: "^" },
    inputs: {
      ONE: NUMBER,
      TWO: NUMBER,
    },
  },
  "operators.advancedMathExpanded": {
    opcode: "operator_advMathExpanded",
    kind: "reporter",
    fields: { OPTION: "root" },
    inputs: {
      ONE: NUMBER,
      TWO: NUMBER,
      THREE: NUMBER,
    },
  },
  "operators.advancedLog": {
    opcode: "operator_advlog",
    kind: "reporter",
    inputs: {
      NUM1: NUMBER,
      NUM2: NUMBER,
    },
  },
  "operators.boolify": {
    opcode: "operator_boolify",
    kind: "boolean",
    inputs: {
      ONE: STRING,
    },
  },
  "operators.characterToCode": {
    opcode: "operator_character_to_code",
    kind: "reporter",
    inputs: {
      ONE: STRING,
    },
  },
  "operators.codeToCharacter": {
    opcode: "operator_code_to_character",
    kind: "reporter",
    inputs: {
      ONE: NUMBER,
    },
  },
  "operators.constrain": {
    opcode: "operator_constrainnumber",
    kind: "reporter",
    inputs: {
      inp: NUMBER,
      min: NUMBER,
      max: NUMBER,
    },
  },
  "operators.countAppearances": {
    opcode: "operator_countAppearTimes",
    kind: "reporter",
    inputs: {
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "operators.falseValue": {
    opcode: "operator_falseBoolean",
    kind: "boolean",
  },
  "operators.lettersBetween": {
    opcode: "operator_getLettersFromIndexToIndexInText",
    kind: "reporter",
    inputs: {
      INDEX1: NUMBER,
      INDEX2: NUMBER,
      TEXT: STRING,
    },
  },
  "operators.lettersBetweenFixed": {
    opcode: "operator_getLettersFromIndexToIndexInTextFixed",
    kind: "reporter",
    inputs: {
      INDEX1: NUMBER,
      INDEX2: NUMBER,
      TEXT: STRING,
    },
  },
  "operators.gte": {
    opcode: "operator_gtorequal",
    kind: "boolean",
    inputs: {
      OPERAND1: STRING,
      OPERAND2: STRING,
    },
  },
  "operators.indexOf": {
    opcode: "operator_indexOfTextInText",
    kind: "reporter",
    inputs: {
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "operators.javascriptBoolean": {
    opcode: "operator_javascript_boolean",
    kind: "boolean",
    inputs: {
      JS: STRING,
    },
  },
  "operators.javascriptOutput": {
    opcode: "operator_javascript_output",
    kind: "reporter",
    inputs: {
      JS: STRING,
    },
  },
  "operators.join3": {
    opcode: "operator_join3",
    kind: "reporter",
    inputs: {
      STRING1: STRING,
      STRING2: STRING,
      STRING3: STRING,
    },
  },
  "operators.lastIndexOf": {
    opcode: "operator_lastIndexOfTextInText",
    kind: "reporter",
    inputs: {
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "operators.interpolate": {
    opcode: "operator_lerpFunc",
    kind: "reporter",
    inputs: {
      ONE: NUMBER,
      TWO: NUMBER,
      AMOUNT: NUMBER,
    },
  },
  "operators.lte": {
    opcode: "operator_ltorequal",
    kind: "boolean",
    inputs: {
      OPERAND1: STRING,
      OPERAND2: STRING,
    },
  },
  "operators.nand": {
    opcode: "operator_nand",
    kind: "boolean",
    inputs: {
      OPERAND1: BOOLEAN,
      OPERAND2: BOOLEAN,
    },
  },
  "operators.newLine": {
    opcode: "operator_newLine",
    kind: "reporter",
  },
  "operators.nor": {
    opcode: "operator_nor",
    kind: "boolean",
    inputs: {
      OPERAND1: BOOLEAN,
      OPERAND2: BOOLEAN,
    },
  },
  "operators.notEqual": {
    opcode: "operator_notequal",
    kind: "boolean",
    inputs: {
      OPERAND1: STRING,
      OPERAND2: STRING,
    },
  },
  "operators.power": {
    opcode: "operator_power",
    kind: "reporter",
    inputs: {
      NUM1: NUMBER,
      NUM2: NUMBER,
    },
  },
  "operators.randomBoolean": {
    opcode: "operator_randomBoolean",
    kind: "boolean",
  },
  "operators.readLine": {
    opcode: "operator_readLineInMultilineText",
    kind: "reporter",
    inputs: {
      LINE: NUMBER,
      TEXT: STRING,
    },
  },
  "operators.regexMatch": {
    opcode: "operator_regexmatch",
    kind: "reporter",
    inputs: {
      text: STRING,
      reg: STRING,
      regrule: STRING,
    },
  },
  "operators.replaceAll": {
    opcode: "operator_replaceAll",
    kind: "reporter",
    inputs: {
      text: STRING,
      term: STRING,
      res: STRING,
    },
  },
  "operators.replaceFirst": {
    opcode: "operator_replaceFirst",
    kind: "reporter",
    inputs: {
      text: STRING,
      term: STRING,
      res: STRING,
    },
  },
  "operators.stringify": {
    opcode: "operator_stringify",
    kind: "reporter",
    inputs: {
      ONE: STRING,
    },
  },
  "operators.tabCharacter": {
    opcode: "operator_tabCharacter",
    kind: "reporter",
  },
  "operators.includesLetterFrom": {
    opcode: "operator_textIncludesLetterFrom",
    kind: "boolean",
    inputs: {
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "operators.startsWithOrEndsWith": {
    opcode: "operator_textStartsOrEndsWith",
    kind: "boolean",
    fields: { OPTION: "starts" },
    inputs: {
      TEXT1: STRING,
      TEXT2: STRING,
    },
  },
  "operators.toCase": {
    opcode: "operator_toUpperLowerCase",
    kind: "reporter",
    fields: { OPTION: "upper" },
    inputs: {
      TEXT: STRING,
    },
  },
  "operators.trueValue": {
    opcode: "operator_trueBoolean",
    kind: "boolean",
  },
  "operators.xnor": {
    opcode: "operator_xnor",
    kind: "boolean",
    inputs: {
      OPERAND1: STRING,
      OPERAND2: STRING,
    },
  },
  "operators.xor": {
    opcode: "operator_xor",
    kind: "boolean",
    inputs: {
      OPERAND1: STRING,
      OPERAND2: STRING,
    },
  },

  // ---- sensing (PenguinMod) --------------------------------------------
  "sensing.directionBetween": {
    opcode: "sensing_directionTo",
    kind: "reporter",
    inputs: {
      x2: STRING,
      y2: STRING,
      x1: STRING,
      y1: STRING,
    },
  },
  "sensing.distanceBetween": {
    opcode: "sensing_distanceTo",
    kind: "reporter",
    inputs: {
      x1: STRING,
      y1: STRING,
      x2: STRING,
      y2: STRING,
    },
  },
  "sensing.fingerDown": {
    opcode: "sensing_fingerdown",
    kind: "boolean",
    inputs: {
      FINGER_OPTION: FINGER_MENU,
    },
  },
  "sensing.fingerTapped": {
    opcode: "sensing_fingertapped",
    kind: "boolean",
    inputs: {
      FINGER_OPTION: FINGER_MENU,
    },
  },
  "sensing.fingerX": {
    opcode: "sensing_fingerx",
    kind: "reporter",
    inputs: {
      FINGER_OPTION: FINGER_MENU,
    },
  },
  "sensing.fingerY": {
    opcode: "sensing_fingery",
    kind: "reporter",
    inputs: {
      FINGER_OPTION: FINGER_MENU,
    },
  },
  "sensing.browser": {
    opcode: "sensing_getbrowser",
    kind: "reporter",
  },
  "sensing.clipboard": {
    opcode: "sensing_getclipboard",
    kind: "reporter",
  },
  "sensing.isDraggable": {
    opcode: "sensing_getdragmode",
    kind: "boolean",
  },
  "sensing.operatingSystem": {
    opcode: "sensing_getoperatingsystem",
    kind: "reporter",
  },
  "sensing.spriteWithAttribute": {
    opcode: "sensing_getspritewithattrib",
    kind: "reporter",
    inputs: {
      var: STRING,
      val: STRING,
    },
  },
  "sensing.url": {
    opcode: "sensing_geturl",
    kind: "reporter",
  },
  "sensing.touchingSpritePoint": {
    opcode: "sensing_getxyoftouchingsprite",
    kind: "reporter",
    fields: { XY: "x" },
    inputs: {
      SPRITE: DISTANCE_MENU,
    },
  },
  "sensing.isUpperCase": {
    opcode: "sensing_isUpperCase",
    kind: "boolean",
    inputs: {
      text: STRING,
    },
  },
  "sensing.keyHit": {
    opcode: "sensing_keyhit",
    kind: "boolean",
    inputs: {
      KEY_OPTION: KEY_MENU,
    },
  },
  "sensing.loggedIn": {
    opcode: "sensing_loggedin",
    kind: "boolean",
  },
  "sensing.isMobile": {
    opcode: "sensing_mobile",
    kind: "boolean",
  },
  "sensing.mouseClicked": {
    opcode: "sensing_mouseclicked",
    kind: "boolean",
  },
  "sensing.mouseScrolling": {
    opcode: "sensing_mousescrolling",
    kind: "boolean",
    inputs: {
      SCROLL_OPTION: SCROLL_MENU,
    },
  },
  "sensing.objectTouchingClone": {
    opcode: "sensing_objecttouchingclonesprite",
    kind: "boolean",
    inputs: {
      FULLTOUCHINGOBJECTMENU: FULL_TOUCHING_MENU,
      SPRITETOUCHINGOBJECTMENU: SPRITE_TOUCHING_MENU,
    },
  },
  "sensing.objectTouchingObject": {
    opcode: "sensing_objecttouchingobject",
    kind: "boolean",
    inputs: {
      FULLTOUCHINGOBJECTMENU: FULL_TOUCHING_MENU,
      SPRITETOUCHINGOBJECTMENU: SPRITE_TOUCHING_MENU,
    },
  },
  "sensing.regexTest": {
    opcode: "sensing_regextest",
    kind: "boolean",
    inputs: {
      text: STRING,
      reg: STRING,
      regrule: STRING,
    },
  },
  "sensing.setClipboard": {
    opcode: "sensing_setclipboard",
    inputs: {
      ITEM: STRING,
    },
  },
  "sensing.hasNumber": {
    opcode: "sensing_thing_has_number",
    kind: "boolean",
    inputs: {
      TEXT1: STRING,
    },
  },
  "sensing.isNumber": {
    opcode: "sensing_thing_is_number",
    kind: "boolean",
    inputs: {
      TEXT1: STRING,
    },
  },
  "sensing.isText": {
    opcode: "sensing_thing_is_text",
    kind: "boolean",
    inputs: {
      TEXT1: STRING,
    },
  },

  // ---- sound (PenguinMod) --------------------------------------------
  "sound.effectValue": {
    opcode: "sound_getEffectValue",
    kind: "reporter",
    fields: { EFFECT: "PITCH" },
  },
  "sound.lengthOf": {
    opcode: "sound_getLength",
    kind: "reporter",
    inputs: {
      SOUND_MENU: SOUND_MENU,
    },
  },
  "sound.soundVolume": {
    opcode: "sound_getSoundVolume",
    kind: "reporter",
    inputs: {
      SOUND_MENU: SOUND_MENU,
    },
  },
  "sound.isPlaying": {
    opcode: "sound_isSoundPlaying",
    kind: "boolean",
    inputs: {
      SOUND_MENU: SOUND_MENU,
    },
  },
  "sound.playAt": {
    opcode: "sound_play_at_seconds",
    inputs: {
      SOUND_MENU: SOUND_MENU,
      VALUE: NUMBER,
    },
  },
  "sound.playAtUntilDone": {
    opcode: "sound_play_at_seconds_until_done",
    inputs: {
      SOUND_MENU: SOUND_MENU,
      VALUE: NUMBER,
    },
  },
  "sound.playAllSounds": {
    opcode: "sound_playallsounds",
  },
  "sound.setFadeOut": {
    opcode: "sound_set_stop_fadeout_to",
    inputs: {
      VALUE: NUMBER,
      SOUND_MENU: SOUND_MENU,
    },
  },
  "sound.stop": {
    opcode: "sound_stop",
    inputs: {
      SOUND_MENU: SOUND_MENU,
    },
  },
};

/**
 * Catalog entries with the default `kind` filled in: everything is a command
 * unless the table above said otherwise.
 * @type {Record<string, object>}
 */
export const CATALOG = Object.fromEntries(
  Object.entries(CORE_CATALOG).map(([name, entry]) => [
    name,
    { kind: "command", ...entry },
  ]),
);

/**
 * Native Scratch variable/list mutation opcodes used when a list method is
 * called (`items.push(x)` etc.).
 */
export const LIST_OPS = {
  push: {
    opcode: "data_addtolist",
    kind: "command",
    inputs: ["ITEM"],
    aliases: ["add", "append"],
  },
  insert: {
    opcode: "data_insertatlist",
    kind: "command",
    inputs: ["INDEX", "ITEM"],
  },
  replace: {
    opcode: "data_replaceitemoflist",
    kind: "command",
    inputs: ["INDEX", "ITEM"],
    aliases: ["set"],
  },
  deleteAt: {
    opcode: "data_deleteoflist",
    kind: "command",
    inputs: ["INDEX"],
    aliases: ["remove", "delete"],
  },
  deleteAll: {
    opcode: "data_deletealloflist",
    kind: "command",
    inputs: [],
    aliases: ["clear"],
  },
  show: { opcode: "data_showlist", kind: "command", inputs: [] },
  hide: { opcode: "data_hidelist", kind: "command", inputs: [] },
  itemAt: {
    opcode: "data_itemoflist",
    kind: "reporter",
    inputs: ["INDEX"],
    aliases: ["at"],
  },
  itemNumber: {
    opcode: "data_itemnumoflist",
    kind: "reporter",
    inputs: ["ITEM"],
    aliases: ["indexOf"],
  },
  length: { opcode: "data_lengthoflist", kind: "reporter", inputs: [] },
  contains: {
    opcode: "data_listcontainsitem",
    kind: "boolean",
    inputs: ["ITEM"],
  },
};

/** Reverse lookup built once: opcode -> canonical catalog name. */
export const BY_OPCODE = (() => {
  const map = new Map();
  for (const [name, entry] of Object.entries(CATALOG)) {
    if (!map.has(entry.opcode)) map.set(entry.opcode, name);
  }
  return map;
})();

/** Core (non-extension) opcode prefixes. */
export const CORE_EXTENSIONS = new Set([
  "argument",
  "colour",
  "control",
  "data",
  "event",
  "looks",
  "math",
  "motion",
  "operator",
  "procedures",
  "sensing",
  "sound",
]);

/**
 * Determine the extension id (if any) required by an opcode.
 * @param {string} opcode
 * @returns {string|null}
 */
export function extensionForOpcode(opcode) {
  const index = opcode.indexOf("_");
  if (index < 0) return null;
  const prefix = opcode.slice(0, index);
  if (CORE_EXTENSIONS.has(prefix)) return null;
  return prefix;
}

/** Resolve a catalog entry, following aliases like `motion.moveSteps`. */
export function lookup(name) {
  if (Object.prototype.hasOwnProperty.call(CATALOG, name)) return CATALOG[name];
  return null;
}

/** List every canonical block name in the catalog. */
export function blockNames() {
  return Object.keys(CATALOG).sort();
}
