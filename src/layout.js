/**
 * Workspace layout for compiled scripts.
 *
 * Mimics Scratch's built-in "Clean up Blocks" command: every top-level script
 * is stacked in a single vertical column, starting half a grid cell in from
 * the corner. Each script is placed one `MIN_BLOCK_Y` below the bottom of the
 * previous script, in source order. Unlike the enhanced clean up tool in
 * Scratch Addons, no columns are created and scripts are never reordered.
 *
 * A generated project has no previous arrangement to preserve, so source order
 * is the natural order for the column. Rendered sizes are estimated from the
 * block tree with the same row metrics scratch-blocks uses. Scratch draws
 * extension blocks one grid unit taller than core blocks, so those are
 * accounted for as well.
 *
 * Measurement reads both project JSON (inputs are `[type, value]` arrays) and
 * the shape scratch-vm's `Blocks` keeps after loading a project (inputs are
 * `{name, block, shadow}` objects), so tests can measure the workspace the VM
 * actually deserialized.
 */

/**
 * Scratch-gui's workspace grid spacing (`grid.spacing` in blocks.jsx). The
 * clean up command itself does not snap, but half a cell is a comfortable
 * margin for the column.
 */
export const GRID_SIZE = 40;

/** Half a grid cell, used as the workspace margin. */
export const GRID_OFFSET = GRID_SIZE / 2;

/** Default size of a Scratch comment bubble. */
export const COMMENT_WIDTH = 200;
export const COMMENT_HEIGHT = 100;

// scratch-blocks metrics, in pixels (GRID_UNIT is 4 there; these are the
// derived values from block_render_svg_vertical.js).
const NOTCH_HEIGHT = 8;

/** Height of one block row, and the gap left between packed scripts. */
export const MIN_BLOCK_Y = 48;
const MIN_STATEMENT_INPUT_HEIGHT = 24;
const EXTRA_STATEMENT_ROW_Y = 32;
const STATEMENT_INDENT = 56;

/** Scratch draws blocks from extensions one grid unit taller. */
const EXTENSION_ROW_EXTRA = 8;

// Width estimates. Scratch renders block labels in a bold 12pt face, which
// averages a little under 10px per character at the editor's scale.
const CHAR_WIDTH = 9;
const BLOCK_PADDING_X = 16;
const ELEMENT_GAP = 8;
const MIN_FIELD_WIDTH = 40;
const MIN_INPUT_WIDTH = 40;
const MIN_SCRIPT_WIDTH = 96;
const DROPDOWN_ARROW_WIDTH = 24;

/** Placeholders a custom block's proccode uses for its arguments. */
const PROCODE_PLACEHOLDER = /%[0-9]+|%[snb]/g;

/** Opcode labels are cached per catalog, which is stable for a whole build. */
const labelMaps = new WeakMap();

/** Opcodes provided by extensions, which scratch-blocks renders taller. */
const extensionSets = new WeakMap();

function extensionsFor(catalog) {
  const known = extensionSets.get(catalog);
  if (known) return known;
  const extensions = new Set();
  for (const entry of Object.values(catalog)) {
    if (entry && entry.opcode && entry.extension) extensions.add(entry.opcode);
  }
  extensionSets.set(catalog, extensions);
  return extensions;
}

/**
 * Build an opcode -> human label map from the catalog. The Fx name is the
 * closest thing a compiler has to the block's rendered text (`motion.moveSteps`
 * reads "move steps").
 */
function labelsFor(catalog) {
  const known = labelMaps.get(catalog);
  if (known) return known;
  const labels = new Map();
  for (const [name, entry] of Object.entries(catalog)) {
    if (entry && entry.opcode) labels.set(entry.opcode, labelWords(name));
  }
  labelMaps.set(catalog, labels);
  return labels;
}

/** Turn `motion.switchCostumeTo` into "switch costume to". */
function labelWords(name) {
  const short = name.slice(name.lastIndexOf(".") + 1);
  return short
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The text a block renders before its fields and inputs. */
function blockLabel(block, labels) {
  // A definition's row is just the prototype block it contains.
  if (
    block.opcode === "procedures_definition" ||
    block.opcode === "procedures_definition_return"
  ) {
    return "";
  }
  if (
    block.opcode === "procedures_call" ||
    block.opcode === "procedures_prototype"
  ) {
    const proccode = block.mutation && block.mutation.proccode;
    if (proccode) return String(proccode).replace(PROCODE_PLACEHOLDER, " ");
  }
  const known = labels.get(block.opcode);
  if (known) return known;
  // Unknown (usually extension) opcodes still have readable words: the first
  // segment is the extension or category id.
  return labelWords(block.opcode.replace(/^[^_]+_/, ""));
}

function textWidth(text) {
  return String(text ?? "").length * CHAR_WIDTH;
}

/** A field is a `[value, id]` array in JSON and a `{value}` object in the VM. */
function fieldValue(field) {
  if (Array.isArray(field)) return field[0];
  if (field && typeof field === "object") return field.value;
  return field;
}

function fieldWidth(value) {
  return Math.max(MIN_FIELD_WIDTH, textWidth(value) + DROPDOWN_ARROW_WIDTH);
}

/**
 * Whether an input holds a nested statement stack. Project JSON uses the same
 * `[2, id]` shape for any block-valued input, so the input name is the only
 * reliable marker; scratch-blocks names statement inputs `SUBSTACK*`.
 */
function isStatementInput(name) {
  return String(name).startsWith("SUBSTACK");
}

/** The first block of a statement input, if one is connected. */
function statementBlockId(input) {
  if (Array.isArray(input))
    return typeof input[1] === "string" ? input[1] : null;
  return input && typeof input.block === "string" ? input.block : null;
}

/**
 * The value an input holds: a compressed `[shadowType, text]` primitive, a
 * reporter block id, or a shadow block id in the VM's representation.
 */
function inputBlockId(input) {
  if (Array.isArray(input)) return input[1] ?? null;
  return input ? (input.block ?? null) : null;
}

/** Width of a shadow primitive block (text box, number, menu, ...). */
function shadowWidth(block) {
  if (block.opcode === "colour_picker") return MIN_FIELD_WIDTH + 8;
  const text = Object.values(block.fields || {})
    .map(fieldValue)
    .join(" ");
  return Math.max(MIN_INPUT_WIDTH, textWidth(text) + 16);
}

/**
 * Width of one value input, following a reporter into its own inputs when one
 * is plugged in.
 */
function inputWidth(blocks, input, labels) {
  const value = inputBlockId(input);
  if (Array.isArray(value)) {
    // Compressed primitive: [shadowType, value]. Colour pickers are fixed size.
    if (value[0] === 9) return MIN_FIELD_WIDTH + 8;
    return Math.max(MIN_INPUT_WIDTH, textWidth(value[1]) + 16);
  }
  if (typeof value !== "string") return MIN_INPUT_WIDTH;
  const child = blocks[value];
  if (!child) return MIN_INPUT_WIDTH;
  // The VM expands primitives into shadow blocks. Reporters and procedure
  // prototypes are real blocks and are measured as such.
  if (child.shadow && !child.mutation) return shadowWidth(child);
  return rowWidth(blocks, child, labels);
}

/**
 * Width of a block's own row (labels, fields and value inputs), before any
 * nested statement stacks widen it.
 */
function rowWidth(blocks, block, labels) {
  let width = BLOCK_PADDING_X + textWidth(blockLabel(block, labels));
  for (const [name, input] of Object.entries(block.inputs || {})) {
    if (isStatementInput(name)) continue;
    width += ELEMENT_GAP + inputWidth(blocks, input, labels);
  }
  for (const field of Object.values(block.fields || {})) {
    width += ELEMENT_GAP + fieldWidth(fieldValue(field));
  }
  return Math.max(width, MIN_SCRIPT_WIDTH);
}

/** Width of a block, including the statement stacks nested inside it. */
function blockWidth(blocks, block, labels) {
  const own = rowWidth(blocks, block, labels);
  let nested = 0;
  for (const [name, input] of Object.entries(block.inputs || {})) {
    if (!isStatementInput(name)) continue;
    const first = statementBlockId(input);
    if (first && blocks[first]) {
      nested = Math.max(nested, stackWidth(blocks, first, labels));
    }
  }
  return nested ? Math.max(own, nested + STATEMENT_INDENT) : own;
}

function stackWidth(blocks, firstId, labels) {
  let width = 0;
  let block = blocks[firstId];
  while (block) {
    width = Math.max(width, blockWidth(blocks, block, labels));
    block = block.next ? blocks[block.next] : null;
  }
  return width;
}

/** Whether an input subtree contains a block from an extension. */
function hasExtensionBlock(blocks, input, extensions) {
  const seen = new Set();
  const visit = (id) => {
    if (typeof id !== "string" || seen.has(id)) return false;
    seen.add(id);
    const block = blocks[id];
    if (!block) return false;
    if (extensions.has(block.opcode)) return true;
    for (const child of Object.values(block.inputs || {})) {
      if (visit(inputBlockId(child))) return true;
    }
    return false;
  };
  return visit(inputBlockId(input));
}

/**
 * Height of a block's own row plus every statement stack nested inside it.
 * Mirrors scratch-blocks' row metrics: a row is MIN_BLOCK_Y tall, a statement
 * input is at least MIN_STATEMENT_INPUT_HEIGHT, every statement input adds the
 * EXTRA_STATEMENT_ROW_Y divider or bottom bar below it, extension blocks are
 * one grid unit taller, and a next-statement notch is part of the block's
 * height. Hats are drawn above the block's origin, so they add no height.
 */
function blockHeight(blocks, block, extensions) {
  let height = MIN_BLOCK_Y;

  // Extension statement blocks render their inline row one grid unit taller,
  // and so do rows holding an extension reporter.
  let inlineRow = extensions.has(block.opcode) && block.parent != null;
  for (const [name, input] of Object.entries(block.inputs || {})) {
    if (!isStatementInput(name)) {
      inlineRow ||= hasExtensionBlock(blocks, input, extensions);
    }
  }
  if (inlineRow) height += EXTENSION_ROW_EXTRA;

  let statements = 0;
  for (const [name, input] of Object.entries(block.inputs || {})) {
    if (!isStatementInput(name)) continue;
    statements += 1;
    const first = statementBlockId(input);
    const inner =
      first && blocks[first] ? stackHeight(blocks, first, extensions) : 0;
    height += Math.max(MIN_STATEMENT_INPUT_HEIGHT, inner - NOTCH_HEIGHT);
  }

  height += statements * EXTRA_STATEMENT_ROW_Y;
  // Stacked blocks overlap the notch above them, so the notch simply becomes
  // part of each block's own height.
  return height + NOTCH_HEIGHT;
}

function stackHeight(blocks, firstId, extensions) {
  let height = 0;
  let first = true;
  let block = blocks[firstId];
  while (block) {
    const own = blockHeight(blocks, block, extensions);
    height += first ? own : own - NOTCH_HEIGHT;
    first = false;
    block = block.next ? blocks[block.next] : null;
  }
  return height;
}

/**
 * Estimated rendered size of the script starting at `firstId`.
 *
 * @param {Record<string, object>} blocks project JSON or scratch-vm blocks map
 * @param {string} firstId id of the script's top-level block
 * @param {Record<string, object>} catalog block catalog used for label widths
 * @returns {{width: number, height: number}}
 */
export function measureScript(blocks, firstId, catalog) {
  const labels = labelsFor(catalog);
  return {
    width: stackWidth(blocks, firstId, labels),
    height: stackHeight(blocks, firstId, extensionsFor(catalog)),
  };
}

/**
 * Position every top-level script on a target like Scratch's built-in clean up
 * command: one vertical column, each script one block row below the previous
 * script's bottom. Attached comments keep their auto-positioning; standalone
 * workspace comments follow the column.
 *
 * @param {object} target project target whose blocks are already serialized
 * @param {Record<string, object>} catalog block catalog used for label widths
 */
export function layoutTarget(target, catalog) {
  const scripts = Object.entries(target.blocks).filter(
    ([, block]) => block.topLevel,
  );

  let cursorY = GRID_OFFSET;
  for (const [id, block] of scripts) {
    const { height } = measureScript(target.blocks, id, catalog);
    block.x = GRID_OFFSET;
    block.y = cursorY;
    cursorY = block.y + height + MIN_BLOCK_Y;
  }

  layoutWorkspaceComments(target, cursorY);
}

/**
 * Place unpositioned workspace comments (`blockId: null`, no x/y) below the
 * scripts in the same column. The config comment already has a position and is
 * left alone.
 */
function layoutWorkspaceComments(target, startY) {
  const comments = Object.values(target.comments || {}).filter(
    (comment) => comment.blockId == null && comment.x == null,
  );

  let cursorY = startY;
  for (const comment of comments) {
    comment.x = GRID_OFFSET;
    comment.y = cursorY;
    cursorY += (comment.height || COMMENT_HEIGHT) + MIN_BLOCK_Y;
  }
}
