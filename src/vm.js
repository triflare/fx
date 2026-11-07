/**
 * Headless PenguinMod VM adapter.
 *
 * `fx test` runs projects against the real PenguinMod runtime. The VM is a
 * browser module that touches a handful of DOM globals at import time, so this
 * module provides minimal in-memory stand-ins for storage and rendering and
 * requires the VM lazily. Loading a project never draws anything, so the
 * no-op renderer is enough to deserialize targets, costumes, and blocks.
 *
 * The VM is shipped as a runtime dependency: `fx test` reports a clear
 * error when it is not installed instead of failing at import time.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";

let modules = null;

/** Blob URLs the VM created for project extension sources, keyed by URL. */
const extensionBlobs = new Map();

/** Install the DOM globals the VM reads while it is being imported. */
function installGlobals() {
  globalThis.location ||= {
    search: "",
    href: "http://localhost/",
    origin: "http://localhost",
    protocol: "http:",
    host: "localhost",
    hostname: "localhost",
    pathname: "/",
    hash: "",
  };
  globalThis.DOMParser ||= class {
    parseFromString() {
      const empty = () => [];
      return {
        querySelectorAll: empty,
        getElementsByTagName: empty,
        querySelector: () => null,
      };
    }
  };
  globalThis.window ||= globalThis;
  globalThis.self ||= globalThis;

  // The VM loads a project extension like a page does: fetch its URL, wrap the
  // result in a Blob, read that Blob with FileReader, then append a script.
  // These shims keep that flow working without a DOM.
  globalThis.FileReader ||= class {
    readAsText(blob) {
      Promise.resolve(blob.text()).then(
        (result) => this.onload?.({ target: { result } }),
        (error) => this.onerror?.(error),
      );
    }
  };
  if (!globalThis.URL.createObjectURL.__fxHeadless) {
    const createObjectURL = globalThis.URL.createObjectURL.bind(globalThis.URL);
    globalThis.URL.createObjectURL = (blob) => {
      const url = createObjectURL(blob);
      extensionBlobs.set(url, blob);
      return url;
    };
    globalThis.URL.createObjectURL.__fxHeadless = true;
  }

  /** Run an appended `<script>` whose `src` is one of the VM's Blob URLs. */
  const runScript = (node) => {
    const blob = extensionBlobs.get(node.src);
    if (!blob) {
      node.onerror?.(new Error(`Cannot read extension script ${node.src}`));
      return;
    }
    Promise.resolve(blob.text()).then(
      (source) => {
        try {
          // The unsandboxed loader installs `global.Scratch` before appending
          // the script, so evaluating here matches a browser script tag.
          runInThisContext(source, { filename: node.src });
          node.onload?.();
        } catch (error) {
          node.onerror?.(error);
        }
      },
      (error) => node.onerror?.(error),
    );
  };

  globalThis.document ||= {
    createElement: (tagName) => ({
      tagName: String(tagName).toUpperCase(),
      style: {},
      getContext: () => null,
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      remove() {},
    }),
    body: {
      appendChild(node) {
        if (node?.tagName === "SCRIPT") runScript(node);
      },
    },
    querySelector: () => null,
    addEventListener() {},
  };
}

/**
 * Load `scratch-vm` on first use.
 * @returns {{VirtualMachine: any, centralDispatch: any}}
 */
export function loadVmModules() {
  if (modules) return modules;
  installGlobals();
  const require = createRequire(import.meta.url);
  let VirtualMachine;
  let centralDispatch;
  try {
    VirtualMachine = require("scratch-vm");
    centralDispatch = require("scratch-vm/src/dispatch/central-dispatch");
  } catch (error) {
    throw new Error(
      "Running tests needs the PenguinMod VM, which could not be loaded. " +
        "Reinstall @triflare/fx with its runtime dependencies and try again.",
      { cause: error },
    );
  }
  modules = { VirtualMachine, centralDispatch };
  return modules;
}

const AssetType = {
  ImageVector: { name: "ImageVector", runtimeFormat: "svg" },
  ImageBitmap: { name: "ImageBitmap", runtimeFormat: "png" },
  Sound: { name: "Sound", runtimeFormat: "wav" },
};

const DataFormat = {
  SVG: "svg",
  PNG: "png",
  JPG: "jpg",
  BMP: "bmp",
  GIF: "gif",
  WAV: "wav",
  MP3: "mp3",
  OGG: "ogg",
  FLAC: "flac",
};

const md5 = (data) =>
  crypto.createHash("md5").update(Buffer.from(data)).digest("hex");

/** In-memory storage module so the VM can load assets headlessly. */
export function createStorage() {
  return {
    AssetType,
    DataFormat,
    createAsset(assetType, dataFormat, data, assetId, generateId) {
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      return {
        assetType,
        dataFormat,
        data: bytes,
        assetId: assetId ?? (generateId ? md5(bytes) : null),
        clean: true,
        encodeDataURI() {
          const base64 = Buffer.from(this.data).toString("base64");
          return `data:${dataFormat};base64,${base64}`;
        },
        decodeText() {
          return Buffer.from(this.data).toString("utf8");
        },
        encodeTextData(text) {
          this.data = new Uint8Array(Buffer.from(text, "utf8"));
          this.assetId = md5(this.data);
        },
      };
    },
  };
}

/** No-op renderer: enough state for blocks that inspect or create skins. */
export function createRenderer() {
  let nextId = 0;
  const skins = {};
  const createSkin = (size = [0, 0]) => {
    const skinId = nextId++;
    skins[skinId] = {
      id: skinId,
      renderQuality: 1,
      _size: size,
      _setTexture() {},
    };
    return skinId;
  };
  return {
    _allSkins: skins,
    _groupOrdering: [],
    useHighQualityRender: true,
    setLayerGroupOrdering() {},
    setPrivateSkinAccess() {},
    setUseHighQualityRender() {},
    setRenderOffscreen() {},
    setStageSize() {},
    draw() {},
    markDrawableAsNoninteractive() {},
    createDrawable() {
      return nextId++;
    },
    destroyDrawable() {},
    updateDrawableSkinId() {},
    updateDrawablePosition() {},
    updateDrawableDirectionScale() {},
    updateDrawableVisible() {},
    updateDrawableEffect() {},
    setDrawableOrder() {},
    getDrawableOrder() {
      return 0;
    },
    getFencedPositionOfDrawable(id, position) {
      return position;
    },
    getBounds() {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    },
    getBoundsForBubble() {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    },
    isTouchingDrawables() {
      return false;
    },
    drawableTouching() {
      return false;
    },
    getTouchingDrawablesPoint() {
      return [];
    },
    isTouchingColor() {
      return false;
    },
    createSVGSkin() {
      return createSkin();
    },
    createBitmapSkin() {
      return createSkin();
    },
    createPenSkin() {
      return createSkin();
    },
    getSkinSize(skinId) {
      return skins[skinId] ? skins[skinId]._size : [0, 0];
    },
    getSkinRotationCenter() {
      return [0, 0];
    },
    penClear() {},
    penLine() {},
    penPoint() {},
    penStamp() {},
    penTranslate() {},
  };
}

/**
 * Create a headless VM with in-memory storage and a no-op renderer.
 *
 * Project extensions are plain JavaScript, and the only way to run them here is
 * unsandboxed in this Node process: loading one is equivalent to running the
 * project's code with full filesystem and network access. Nothing is loaded
 * unless `allowProjectExtensions` is set. Callers opt in explicitly (for `fx
 * test` that means the user passes `--allow-project-extensions`) to state that
 * the project's extensions are trusted for this run.
 *
 * The dispatch broker is a process-wide singleton; dropping its services keeps
 * one VM's extensions from logging a provider conflict for the next.
 *
 * @param {{allowProjectExtensions?: boolean}} [options]
 */
export function createVm({ allowProjectExtensions = false } = {}) {
  const { VirtualMachine, centralDispatch } = loadVmModules();
  centralDispatch.services = {};
  const vm = new VirtualMachine();
  vm.attachStorage(createStorage());
  vm.attachRenderer(createRenderer());
  // Denying the load keeps both the extension source and its top-level code
  // from running, even when the project only configured it and no block uses
  // it. The VM reports "Permission to load extension denied" for the project.
  vm.securityManager.canLoadExtensionFromProject = () =>
    Promise.resolve(allowProjectExtensions);
  // Node has neither the web worker nor the iframe sandbox the VM would use, so
  // a permitted extension runs in this process, exactly like PenguinMod's
  // unsandboxed mode. Denied extensions never reach the sandbox selector.
  vm.securityManager.getSandboxMode = () =>
    Promise.resolve(allowProjectExtensions ? "unsandboxed" : "iframe");
  return vm;
}

/**
 * Build a fresh VM and load an sb3/pmp buffer into it.
 * @param {Buffer} sb3
 * @param {{allowProjectExtensions?: boolean}} [options]
 */
export const loadProject = async (sb3, options = {}) => {
  const vm = createVm(options);
  // Loading an extension logs its whole source to the console; keep reporter
  // output (especially JSON and JUnit) parseable.
  const log = console.log;
  console.log = () => {};
  try {
    await vm.loadProject(sb3);
  } catch (error) {
    try {
      vm.stopAll();
    } catch {
      // Preserve the original load error if cleanup also fails.
    }
    throw error;
  } finally {
    console.log = log;
  }
  return vm;
};
