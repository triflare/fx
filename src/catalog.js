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
