/**
 * PenguinMod extension bindings.
 *
 * Triflare Fx keeps its catalog centralized, so third-party extensions are
 * supported by *synthesizing* catalog entries at build time: the extension
 * source is evaluated in an isolated QuickJS WebAssembly runtime that shims the
 * `Scratch.*` API it expects, then `getInfo()` is read back and translated into
 * the same descriptor shape used by `catalog.js`.
 *
 * A Triflare Fx call `myExtension.myBlock(...)` maps onto the runtime opcode
 * `myExtension_myBlock`, exactly how scratch-vm names extension blocks.
 *
 * Extension sources are untrusted: they run with no filesystem, network or
 * `process` access. Remote sources are fetched with the global `fetch`.
 *
 * Many PenguinMod gallery extensions refuse to load unless they run
 * *unsandboxed* (`if (!Scratch.extensions.unsandboxed) throw ...`). Whether an
 * extension actually runs sandboxed is decided by the editor (or packager), not
 * by us, so compilation must not be the thing that blocks them: when a sandboxed
 * evaluation throws we retry with an unsandboxed `Scratch` API. Extensions that
 * only load that way are reported as `unsandboxed` so the CLI can warn that they
 * must be allowed to run unsandboxed when the project is opened.
 */
import fs from "node:fs";
import path from "node:path";
import { getQuickJS } from "quickjs-emscripten";

/** `Scratch.BlockType` (values used by scratch-vm / PenguinMod). */
export const BlockType = {
  BOOLEAN: "Boolean",
  BUTTON: "button",
  LABEL: "label",
  COMMAND: "command",
  CONDITIONAL: "conditional",
  EVENT: "event",
  HAT: "hat",
  LOOP: "loop",
  REPORTER: "reporter",
  XML: "xml",
};

/** `Scratch.ArgumentType`. */
export const ArgumentType = {
  ANGLE: "angle",
  BOOLEAN: "Boolean",
  COLOR: "color",
  NUMBER: "number",
  STRING: "string",
  MATRIX: "matrix",
  NOTE: "note",
  IMAGE: "image",
  POLYGON: "polygon",
  CUSTOM: "custom",
  COSTUME: "costume",
  SOUND: "sound",
  VARIABLE: "variable",
  LIST: "list",
  BROADCAST: "broadcast",
  SEPERATOR: "seperator",
};

/** `Scratch.ArgumentAlignment`. */
export const ArgumentAlignment = {
  DEFAULT: null,
  LEFT: "LEFT",
  CENTER: "CENTRE",
  RIGHT: "RIGHT",
};

/** `Scratch.BlockShape` (PenguinMod's richer value types). */
export const BlockShape = {
  HEXAGONAL: 1,
  ROUND: 2,
  SQUARE: 3,
  LEAF: 4,
  PLUS: 5,
  OCTAGONAL: 6,
  BUMPED: 7,
  INDENTED: 8,
  SCRAPPED: 9,
  ARROW: 10,
  TICKET: 11,
};

/** `Scratch.NotchShape`. */
export const NotchShape = {
  SWITCH: "switchCase",
  HEXAGON: "hexagon",
  ROUND: "round",
  SQUARE: "square",
  LEAF: "leaf",
  PLUS: "plus",
  OCTAGONAL: "octagonal",
  BUMPED: "bumped",
  INDENTED: "indented",
  SCRAPPED: "scrapped",
  ARROW: "arrow",
  TICKET: "ticket",
  JIGSAW: "jigsaw",
  INVERTED: "inverted",
  PINCER: "pincer",
};

/** `Scratch.TargetType`. */
export const TargetType = {
  SPRITE: "sprite",
  STAGE: "stage",
};

/** `Scratch.Clone`. */
export const Clone = {
  simple: (original) => JSON.parse(JSON.stringify(original)),
};

/** `Scratch.Color`. */
export const Color = {
  get RGB_BLACK() {
    return { r: 0, g: 0, b: 0 };
  },
  get RGB_WHITE() {
    return { r: 255, g: 255, b: 255 };
  },
  decimalToHex(decimal) {
    let value = decimal;
    if (value < 0) value += 0xffffff + 1;
    let hex = Math.round(Number(value)).toString(16);
    hex = `#${"000000".slice(0, 6 - hex.length)}${hex}`;
    return hex;
  },
  decimalToRgb(decimal) {
    const a = (decimal >> 24) & 0xff;
    return {
      r: (decimal >> 16) & 0xff,
      g: (decimal >> 8) & 0xff,
      b: decimal & 0xff,
      a: a > 0 ? a : 255,
    };
  },
  hexToRgb(hex) {
    let value = hex;
    if (value.startsWith("#")) value = value.slice(1);
    if (value.length === 8) value = value.slice(0, 6);
    const parsed = parseInt(value, 16);
    if (Number.isNaN(parsed)) return null;
    if (value.length === 6)
      return {
        r: (parsed >> 16) & 0xff,
        g: (parsed >> 8) & 0xff,
        b: parsed & 0xff,
      };
    if (value.length === 3) {
      const r = (parsed >> 8) & 0xf;
      const g = (parsed >> 4) & 0xf;
      const b = parsed & 0xf;
      return { r: (r << 4) | r, g: (g << 4) | g, b: (b << 4) | b };
    }
    return null;
  },
  rgbToHex(rgb) {
    return Color.decimalToHex(Color.rgbToDecimal(rgb));
  },
  rgbToDecimal(rgb) {
    return (rgb.r << 16) + (rgb.g << 8) + rgb.b;
  },
  hexToDecimal(hex) {
    return Color.rgbToDecimal(Color.hexToRgb(hex));
  },
  hsvToRgb(hsv) {
    let h = hsv.h % 360;
    if (h < 0) h += 360;
    const s = Math.max(0, Math.min(hsv.s, 1));
    const v = Math.max(0, Math.min(hsv.v, 1));

    const i = Math.floor(h / 60);
    const f = h / 60 - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));

    let r;
    let g;
    let b;
    switch (i) {
      default:
      case 0:
        r = v;
        g = t;
        b = p;
        break;
      case 1:
        r = q;
        g = v;
        b = p;
        break;
      case 2:
        r = p;
        g = v;
        b = t;
        break;
      case 3:
        r = p;
        g = q;
        b = v;
        break;
      case 4:
        r = t;
        g = p;
        b = v;
        break;
      case 5:
        r = v;
        g = p;
        b = q;
        break;
    }

    return {
      r: Math.floor(r * 255),
      g: Math.floor(g * 255),
      b: Math.floor(b * 255),
    };
  },
  rgbToHsv(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const x = Math.min(Math.min(r, g), b);
    const v = Math.max(Math.max(r, g), b);

    // For greys hue is arbitrarily reported as zero.
    let h = 0;
    let s = 0;
    if (x !== v) {
      const f = r === x ? g - b : g === x ? b - r : r - g;
      const i = r === x ? 3 : g === x ? 5 : 1;
      h = ((i - f / (v - x)) * 60) % 360;
      s = (v - x) / v;
    }

    return { h: h, s: s, v: v };
  },
  mixRgb(rgb0, rgb1, fraction1) {
    if (fraction1 <= 0) return rgb0;
    if (fraction1 >= 1) return rgb1;
    const fraction0 = 1 - fraction1;
    return {
      r: fraction0 * rgb0.r + fraction1 * rgb1.r,
      g: fraction0 * rgb0.g + fraction1 * rgb1.g,
      b: fraction0 * rgb0.b + fraction1 * rgb1.b,
    };
  },
};

/**
 * `Scratch.Cast` (scratch-vm's `util/cast`, as exposed to extensions).
 *
 * Each member mirrors the VM's implementation, including Scratch's own
 * coercion rules — `Cast.toBoolean("0")` is false, `Cast.compare` is
 * case-insensitive for text and numeric otherwise.
 */
export const Cast = {
  toString: (value) => String(value),
  toNumber: (value) => {
    if (typeof value === "number") return Number.isNaN(value) ? 0 : value;
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  },
  toBoolean: (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      // These exact strings are false in Scratch; everything else is true.
      if (value === "" || value === "0" || value.toLowerCase() === "false")
        return false;
      return true;
    }
    return Boolean(value);
  },
  /** 0 when equal, negative when `a` sorts first, positive otherwise. */
  compare: (a, b) => {
    // Scratch does not treat "0", "\t" or strings containing them as zero.
    const isNotActuallyZero = (value) => {
      if (typeof value !== "string") return false;
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code === 48 || code === 9) return false;
      }
      return true;
    };
    let n1 = Number(a);
    let n2 = Number(b);
    if (n1 === 0 && isNotActuallyZero(a)) n1 = NaN;
    else if (n2 === 0 && isNotActuallyZero(b)) n2 = NaN;
    if (Number.isNaN(n1) || Number.isNaN(n2)) {
      const s1 = String(a).toLowerCase();
      const s2 = String(b).toLowerCase();
      if (s1 < s2) return -1;
      if (s1 > s2) return 1;
      return 0;
    }
    if (
      (n1 === Infinity && n2 === Infinity) ||
      (n1 === -Infinity && n2 === -Infinity)
    )
      return 0;
    return n1 - n2;
  },
  toRgbColorList: (value) => {
    const color = Cast.toRgbColorObject(value);
    return [color.r, color.g, color.b];
  },
  toRgbColorObject: (value) => {
    let color;
    if (typeof value === "object") value += "";
    if (typeof value === "string" && value.substring(0, 1) === "#") {
      color = Color.hexToRgb(value);
      // A string that only looks like a hex colour casts to black.
      if (!color) color = { r: 0, g: 0, b: 0, a: 255 };
    } else {
      color = Color.decimalToRgb(Cast.toNumber(value));
    }
    return color;
  },
  isWhiteSpace: (value) =>
    value === null || (typeof value === "string" && value.trim().length === 0),
  isInt: (value) => {
    if (typeof value === "number") {
      if (Number.isNaN(value)) return true;
      return value === Math.floor(value);
    }
    if (typeof value === "boolean") return true;
    if (typeof value === "string") return value.indexOf(".") < 0;
    return false;
  },
  get LIST_INVALID() {
    return "INVALID";
  },
  get LIST_ALL() {
    return "ALL";
  },
  toListIndex: (index, length, acceptAll) => {
    if (typeof index !== "number") {
      if (index === "all") return acceptAll ? Cast.LIST_ALL : Cast.LIST_INVALID;
      if (index === "last") return length > 0 ? length : Cast.LIST_INVALID;
      if (index === "random" || index === "any")
        return length > 0
          ? 1 + Math.floor(Math.random() * length)
          : Cast.LIST_INVALID;
    }
    index = Math.floor(Cast.toNumber(index));
    if (index < 1 || index > length) return Cast.LIST_INVALID;
    return index;
  },
};

// -------------------------------------------------------------- translation

/**
 * Map a `Scratch.ArgumentType` onto a Triflare Fx input descriptor.
 * @param {object} arg
 * @returns {{type: string, default?: string|number}}
 */
function argumentSpec(arg) {
  const type = arg && arg.type;
  let spec;
  switch (type) {
    case ArgumentType.BOOLEAN:
      spec = { type: "boolean" };
      break;
    case ArgumentType.ANGLE:
      spec = { type: "angle" };
      break;
    case ArgumentType.COLOR:
      spec = { type: "color" };
      break;
    // A note is a MIDI number, so it takes numeric input like `NUMBER`.
    case ArgumentType.NOTE:
    case ArgumentType.NUMBER:
      spec = { type: "number" };
      break;
    // Matrix, costume, sound, PM menus and plain strings all travel as text.
    default:
      spec = { type: "string" };
  }
  // Extensions declare the value a call falls back to when it omits the arg.
  if (arg && arg.defaultValue !== undefined && arg.defaultValue !== null) {
    spec.default = arg.defaultValue;
  }
  return spec;
}

/**
 * @param {string} blockType
 * @returns {'command'|'reporter'|'boolean'|'hat'|null} null for non-block types
 */
function blockKind(blockType) {
  switch (blockType) {
    case BlockType.BOOLEAN:
      return "boolean";
    case BlockType.REPORTER:
      return "reporter";
    case BlockType.HAT:
    case BlockType.EVENT:
      return "hat";
    case BlockType.LABEL:
    case BlockType.BUTTON:
    case BlockType.XML:
      return null;
    default:
      return "command";
  }
}

/** Flatten the (possibly nested) `blocks` array from `getInfo()`. */
function flattenBlocks(blocks, out = []) {
  for (const block of blocks || []) {
    if (Array.isArray(block)) flattenBlocks(block, out);
    else if (
      block &&
      typeof block === "object" &&
      typeof block.opcode === "string"
    )
      out.push(block);
  }
  return out;
}

/**
 * Turn one extension `getInfo()` result into catalog entries.
 * @param {Record<string, object>} catalog
 * @param {object} info
 * @param {string} sourceName
 * @returns {number} number of blocks registered
 */
function registerInfo(catalog, info, sourceName) {
  if (!info || typeof info !== "object" || typeof info.id !== "string") {
    throw new Error(
      `extension ${sourceName} did not provide a getInfo() with a string id`,
    );
  }
  const id = info.id;
  let count = 0;
  for (const block of flattenBlocks(info.blocks)) {
    const kind = blockKind(block.blockType);
    if (kind == null) continue;

    const inputs = {};
    for (const [name, arg] of Object.entries(block.arguments || {})) {
      inputs[name] = argumentSpec(arg);
    }

    const entry = {
      opcode: `${id}_${block.opcode}`,
      kind,
      inputs,
      extension: id,
    };
    if (kind === "hat") {
      entry.args = Object.entries(block.arguments || {}).map(([name, arg]) => {
        const spec = argumentSpec(arg);
        return {
          input: name,
          type: spec.type,
          ...(spec.default !== undefined ? { default: spec.default } : {}),
        };
      });
    } else if (
      block.blockType === BlockType.CONDITIONAL ||
      block.blockType === BlockType.LOOP
    ) {
      inputs.SUBSTACK = { type: "substack" };
      if ((block.branchCount || 1) > 1) inputs.SUBSTACK2 = { type: "substack" };
    }

    catalog[`${id}.${block.opcode}`] = entry;
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ sandbox

/**
 * A permissive stand-in for a runtime object.
 *
 * Extensions routinely touch the VM at module scope — `Scratch.vm.runtime.on(…)`,
 * `vm.runtime.registerSerializer(…)`, `Scratch.renderer.…` — none of which is
 * needed to read `getInfo()`. Instead of throwing on a missing browser/VM
 * global, hand back an object that tolerates arbitrary reads, writes and calls.
 * @param {string} label human-readable name, used for `toString`/coercion
 * @returns {any}
 */
function permissive(label) {
  const cache = new Map();
  const fn = function () {
    return proxy;
  };
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === "then") return undefined; // stay non-thenable
      if (prop === Symbol.toPrimitive) return () => label;
      if (prop === "toString" || prop === "valueOf" || prop === "toJSON")
        return () => label;
      if (typeof prop === "symbol") return target[prop];
      if (!cache.has(prop)) cache.set(prop, permissive(`${label}.${prop}`));
      return cache.get(prop);
    },
    set() {
      return true;
    },
    has() {
      return true;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy;
    },
  });
  return proxy;
}

export function makeSandbox(registered, { unsandboxed = false } = {}) {
  /** A function that rejects: the sandbox has no browser or network. */
  const unavailable = (name) => () =>
    Promise.reject(new Error(`${name} is not available while compiling`));
  const Scratch = {
    extensions: {
      register(extension) {
        registered.push(extension);
      },
      // TurboWarp documents `unsandboxed` as true when unsandboxed and
      // undefined otherwise — never false.
      unsandboxed: unsandboxed || undefined,
      // PenguinMod's unsandboxed loader sets this; exposing it in both modes
      // keeps PenguinMod-only extensions loadable here.
      isPenguinMod: true,
    },
    BlockType,
    ArgumentType,
    ArgumentAlignment,
    BlockShape,
    NotchShape,
    TargetType,
    Clone,
    Color,
    Cast,
    // tw-l10n exposes `translate(message, args)`, `translate.setup({…})` and a
    // read-only `translate.language` on the same function. Generated l10n
    // bundles call `setup({…})` at module scope before registering.
    translate: Object.defineProperty(
      Object.assign(
        (message) => {
          if (typeof message === "string") return message;
          if (message && typeof message === "object") {
            return typeof message.default === "string" ? message.default : "";
          }
          throw new Error("unsupported data type in translate()");
        },
        { setup() {} },
      ),
      "language",
      { get: () => "en", enumerable: true },
    ),
    // `Scratch.external` loads sibling resources; the sandbox has no browser,
    // so its entries reject instead of resolving like a module.
    external: {
      importModule: unavailable("Scratch.external"),
      fetch: unavailable("Scratch.external"),
      dataURL: unavailable("Scratch.external"),
      blob: unavailable("Scratch.external"),
      evalAndReturn: unavailable("Scratch.external"),
    },
    canFetch: () => Promise.resolve(false),
    fetch: () =>
      Promise.reject(
        new Error("Scratch.fetch is not available while compiling"),
      ),
    canOpenWindow: () => Promise.resolve(false),
    openWindow: () =>
      Promise.reject(
        new Error("Scratch.openWindow is not available while compiling"),
      ),
    canRedirect: () => Promise.resolve(false),
    redirect: () =>
      Promise.reject(
        new Error("Scratch.redirect is not available while compiling"),
      ),
    canRecordAudio: () => Promise.resolve(false),
    canRecordVideo: () => Promise.resolve(false),
    canReadClipboard: () => Promise.resolve(false),
    canNotify: () => Promise.resolve(false),
    canGeolocate: () => Promise.resolve(false),
    canEmbed: () => Promise.resolve(false),
    // The editor lets the user allow/decline unsandboxing; mirror that here so
    // metadata extraction can see the API the extension is written against.
    canUnsandbox: () => Promise.resolve(Boolean(unsandboxed)),
    canScreenshotCamera: () => Promise.resolve(false),
    canDownload: () => Promise.resolve(false),
    download: () =>
      Promise.reject(
        new Error("Scratch.download is not available while compiling"),
      ),
    vm: permissive("Scratch.vm"),
    renderer: permissive("Scratch.renderer"),
    gui: permissive("Scratch.gui"),
    // Some extensions probe these at module scope.
    runtime: permissive("Scratch.runtime"),
    stage: permissive("Scratch.stage"),
  };

  const sandbox = {
    Scratch,
    ScratchExtensions: {
      register() {
        /* legacy ScratchX extensions unsupported */
      },
    },
    console: permissive("console"),
    // Metadata extraction is synchronous and extension timers must never fire:
    // they would outlive the sandbox and could hold the CLI process open.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URL: permissive("URL"),
    URLSearchParams: permissive("URLSearchParams"),
    TextEncoder: permissive("TextEncoder"),
    TextDecoder: permissive("TextDecoder"),
    Uint8Array,
    ArrayBuffer,
    Math,
    Date,
    JSON,
  };
  // Browser globals unsandboxed extensions touch at module scope. None of them
  // need to do anything to read `getInfo()`; they exist so setup code does not
  // throw. The sandbox has no network, filesystem or real DOM access.
  sandbox.vm = permissive("vm");
  sandbox.document = permissive("document");
  sandbox.navigator = permissive("navigator");
  sandbox.location = permissive("location");
  sandbox.localStorage = permissive("localStorage");
  // NB: `alert` is deliberately left undefined. Extensions use it inside their
  // unsandboxed guard (`if (!Scratch.extensions.unsandboxed) { alert(...); return; }`),
  // so a permissive alert would let the sandboxed probe "succeed" without
  // registering anything and skip the unsandboxed retry.
  sandbox.Audio = permissive("Audio");
  sandbox.Image = permissive("Image");
  sandbox.requestAnimationFrame = permissive("requestAnimationFrame");
  sandbox.cancelAnimationFrame = permissive("cancelAnimationFrame");

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** Encode only our trusted shim definitions as source, without sharing objects. */
function shimSource(value) {
  if (typeof value === "function") {
    const source = value.toString();
    return /^[\w$]+\(/.test(source) ? `function ${source}` : source;
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(Object.getOwnPropertyDescriptors(value))
    .map(([name, descriptor]) =>
      descriptor.get
        ? descriptor.get.toString()
        : `${JSON.stringify(name)}: (${shimSource(descriptor.value)})`,
    )
    .join(",")}}`;
}

/** Evaluate source, getInfo() and serialization inside the same execution limit. */
async function evaluateExtension(
  source,
  filename,
  { unsandboxed = false } = {},
) {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + 5000;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  try {
    // Every shim function is created in QuickJS. Only source text enters and
    // JSON text leaves; extensions never receive host functions or Node APIs.
    const shims = Object.entries({
      BlockType,
      ArgumentType,
      ArgumentAlignment,
      BlockShape,
      NotchShape,
      TargetType,
      Clone,
      Color,
      Cast,
    })
      .map(([name, value]) => `const ${name} = ${shimSource(value)};`)
      .join("\n");
    const result = context.evalCode(
      `(() => {
        ${shims}
        ${permissive.toString()}
        ${makeSandbox.toString()}
        const registered = [];
        Object.assign(globalThis, makeSandbox(registered, {unsandboxed: ${unsandboxed}}));
        const evaluate = eval;
        const stringify = JSON.stringify;
        evaluate(${JSON.stringify(source)});
        const infos = [];
        for (const extension of registered) {
          if (!extension) continue;
          infos.push(typeof extension.getInfo === "function" ? extension.getInfo() : extension);
        }
        return stringify(infos);
      })()`,
      filename,
    );
    try {
      if (result.error) {
        const error = context.dump(result.error);
        const timedOut = Date.now() >= deadline;
        const failure = new Error(
          timedOut
            ? "extension execution timed out"
            : error?.message || "extension evaluation failed",
        );
        if (timedOut) failure.code = "EXTENSION_TIMEOUT";
        throw failure;
      }
      return JSON.parse(context.getString(result.value));
    } finally {
      result.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

// ------------------------------------------------------------------- loading

const DATA_URI = /^data:([^,]*),([\s\S]*)$/i;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/=\s]*$/;

/**
 * Encode extension source as a `data:` URI.
 *
 * Archives only remember extension sources through `project.extensionURLs`, so
 * local extension files are baked in as data URIs (the same trick the
 * PenguinMod packager uses when it bakes extensions). Base64 survives quotes,
 * comments and non-ASCII text without escaping.
 * @param {string} source
 * @returns {string}
 */
export function extensionDataUri(source) {
  const base64 = Buffer.from(String(source), "utf8").toString("base64");
  return `data:text/javascript;base64,${base64}`;
}

/**
 * Decode a `data:` URI back into extension source text.
 * @param {string} uri
 * @returns {string|null} source text, or null when the URI is unsupported
 */
export function readExtensionDataUri(uri) {
  const match = DATA_URI.exec(String(uri).trim());
  if (!match) return null;
  const [, meta, payload] = match;
  try {
    if (/;base64\s*$/i.test(meta)) {
      if (!BASE64_PAYLOAD.test(payload)) return null;
      return Buffer.from(payload, "base64").toString("utf8");
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** Resolve a config entry to source text. */
export async function resolveSource(entry, baseDir, fetchImpl) {
  const value = String(entry);
  if (/^data:/i.test(value)) {
    const source = readExtensionDataUri(value);
    if (source == null)
      throw new Error(
        "unsupported data URI; expected base64 or percent-encoded JavaScript",
      );
    return { source, remote: false, dataUri: true, url: value };
  }
  if (/^https?:\/\//i.test(value)) {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== "function")
      throw new Error("global fetch is unavailable; pass fetchImpl");
    const response = await fetchFn(value);
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return { source: await response.text(), remote: true, url: value };
  }
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir, value);
  return {
    source: fs.readFileSync(resolved, "utf8"),
    remote: false,
    url: value,
    file: resolved,
  };
}

/**
 * Evaluate extension source, retrying unsandboxed when the sandboxed pass
 * throws. Extensions that guard on `Scratch.extensions.unsandboxed` can only be
 * loaded that way, and it is the editor (or packager) that decides it.
 * @param {string} source
 * @param {string} filename
 * @returns {{infos: object[], unsandboxed: boolean}}
 */
async function evaluateExtensionAny(source, filename) {
  try {
    return {
      infos: await evaluateExtension(source, filename, { unsandboxed: false }),
      unsandboxed: false,
    };
  } catch (sandboxedError) {
    if (sandboxedError.code === "EXTENSION_TIMEOUT") throw sandboxedError;
    try {
      return {
        infos: await evaluateExtension(source, filename, { unsandboxed: true }),
        unsandboxed: true,
      };
    } catch (unsandboxedError) {
      const sandboxedMessage = sandboxedError && sandboxedError.message;
      const unsandboxedMessage = unsandboxedError && unsandboxedError.message;
      // Neither mode works. Prefer the unsandboxed failure (the sandboxed one is
      // usually just the extension's own guard) and keep both when they differ.
      if (unsandboxedMessage && unsandboxedMessage !== sandboxedMessage) {
        throw new Error(
          `${unsandboxedMessage} (sandboxed: ${sandboxedMessage})`,
          { cause: unsandboxedError },
        );
      }
      throw unsandboxedError;
    }
  }
}

/**
 * Inspect extension source without running it in the Node.js process.
 * Useful to propose an extension id while vendoring or migrating.
 * @param {string} source
 * @param {string} [filename]
 * @returns {Promise<{infos: object[], unsandboxed: boolean}>}
 */
export async function inspectExtension(source, filename = "extension") {
  return evaluateExtensionAny(source, filename);
}

/**
 * Load a list of extension references.
 *
 * @param {Array<string>} list Paths, `http(s)://` URLs or `data:` URIs.
 * @param {{baseDir?: string, fetchImpl?: typeof fetch, expectUnsandboxed?: string|string[]}} [options]
 *   `expectUnsandboxed` acknowledges extensions that are known to require
 *   unsandboxed mode, silencing the warning for them.
 * @returns {Promise<{catalog: Record<string, object>, extensionUrls: Record<string, string>, warnings: string[], ids: string[], unsandboxed: string[]}>}
 *   `unsandboxed` holds the ids of extensions that only load unsandboxed.
 */
export async function loadExtensions(
  list,
  { baseDir = process.cwd(), fetchImpl, expectUnsandboxed = [] } = {},
) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  const ids = [];
  const unsandboxed = [];
  const declared = new Set(
    (Array.isArray(expectUnsandboxed) ? expectUnsandboxed : [expectUnsandboxed])
      .filter((value) => value != null && value !== "")
      .map(String),
  );
  const declaredSeen = new Set();
  const declaredNotNeeded = new Set();
  const needsDeclaration = [];

  for (const entry of list || []) {
    const label = String(entry);
    // Data URIs are enormous; keep warning lines readable without breaking the
    // path/URL matching that `expectUnsandboxed` relies on.
    const name = label.length > 64 ? `${label.slice(0, 60)}…` : label;
    try {
      const { source, remote, url, file, dataUri } = await resolveSource(
        entry,
        baseDir,
        fetchImpl,
      );
      const { infos, unsandboxed: needsUnsandboxed } =
        await evaluateExtensionAny(
          source,
          remote ? url : (file ?? "extension"),
        );
      if (infos.length === 0) {
        warnings.push(
          `extension ${name} did not call Scratch.extensions.register()`,
        );
        continue;
      }
      for (const info of infos) {
        const count = registerInfo(catalog, info, name);
        if (!ids.includes(info.id)) ids.push(info.id);

        for (const candidate of [info.id, label]) {
          if (!declared.has(candidate)) continue;
          declaredSeen.add(candidate);
          if (!needsUnsandboxed) declaredNotNeeded.add(candidate);
        }

        if (needsUnsandboxed) {
          if (!unsandboxed.includes(info.id)) unsandboxed.push(info.id);
          needsDeclaration.push({ id: info.id, label, name });
        }

        // Remote URLs travel as-is; local (and already embedded) sources are
        // recorded as data URIs so the archive carries the extension with it.
        extensionUrls[info.id] =
          remote || dataUri ? url : extensionDataUri(source);
        if (count === 0)
          warnings.push(
            `extension ${name} (id "${info.id}") exposes no usable blocks`,
          );
      }
    } catch (err) {
      warnings.push(
        `failed to load extension ${name}: ${err && err.message ? err.message : err}`,
      );
    }
  }

  // Extensions that only load unsandboxed error out unless the editor is allowed
  // to run them unsandboxed (or the project is packaged), so say so up front.
  for (const { id, label, name } of needsDeclaration) {
    if (declared.has(id) || declared.has(label)) continue;
    warnings.push(
      `extension ${name} (id "${id}") requires unsandboxed mode; allow it to run ` +
        `unsandboxed when opening the project in PenguinMod (or add "${id}" to ` +
        "project.unsandboxed in fx.yml once you trust it)",
    );
  }
  for (const name of declared) {
    if (declaredNotNeeded.has(name)) {
      warnings.push(
        `project.unsandboxed entry "${name}" loads in the sandbox; remove it from fx.yml`,
      );
    } else if (!declaredSeen.has(name)) {
      warnings.push(
        `project.unsandboxed entry "${name}" does not match any loaded extension`,
      );
    }
  }

  return { catalog, extensionUrls, warnings, ids, unsandboxed };
}
