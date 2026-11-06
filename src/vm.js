/**
 * Headless PenguinMod VM adapter.
 *
 * `fx test` runs projects against the real PenguinMod runtime. The VM is a
 * browser module that touches a handful of DOM globals at import time, so this
 * module provides minimal in-memory stand-ins for storage and rendering and
 * requires the VM lazily. Loading a project never draws anything, so the
 * no-op renderer is enough to deserialize targets, costumes, and blocks.
 *
 * The VM is shipped as a development dependency: `fx test` reports a clear
 * error when it is not installed instead of failing at import time.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

let modules = null;

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
  globalThis.document ||= {
    createElement: () => ({
      style: {},
      getContext: () => null,
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
    }),
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
      "Running tests needs the PenguinMod VM, which is not installed. " +
        "Install dependencies with `npm install` and try again.",
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
          const base64 = Buffer.from(bytes).toString("base64");
          return `data:${dataFormat};base64,${base64}`;
        },
        decodeText() {
          return Buffer.from(bytes).toString("utf8");
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
 * The dispatch broker is a process-wide singleton; dropping its services keeps
 * one VM's extensions from logging a provider conflict for the next.
 */
export function createVm() {
  const { VirtualMachine, centralDispatch } = loadVmModules();
  centralDispatch.services = {};
  const vm = new VirtualMachine();
  vm.attachStorage(createStorage());
  vm.attachRenderer(createRenderer());
  return vm;
}

/**
 * Build a fresh VM and load an sb3/pmp buffer into it.
 * @param {Buffer} sb3
 */
export const loadProject = async (sb3) => {
  const vm = createVm();
  await vm.loadProject(sb3);
  return vm;
};
