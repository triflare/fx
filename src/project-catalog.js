/**
 * Extension catalog assembly shared by `fx test` and `fx run`.
 *
 * Build-like commands already resolve this through `loadProjectState`; the
 * headless runners load it themselves so they can also be called as a Node API.
 */
import { loadExtensions } from "./extensions.js";
import { loadFeatureExtensions } from "./features.js";
import { loadVendorExtensions } from "./vendor.js";

/**
 * Load vendored, feature and legacy extensions into one catalog.
 *
 * @param {{configDir: string, loaded: object}} options
 * @returns {Promise<{catalog: Record<string, object>, extensionUrls: Record<string, string>, warnings: string[]}>}
 */
export async function loadProjectCatalog({ configDir, loaded }) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  if (loaded.vendor?.length) {
    const vendored = await loadVendorExtensions({ configDir, config: loaded });
    Object.assign(catalog, vendored.catalog);
    Object.assign(extensionUrls, vendored.extensionUrls);
    warnings.push(...vendored.warnings);
  }
  const features = await loadFeatureExtensions({ configDir, config: loaded });
  Object.assign(catalog, features.catalog);
  Object.assign(extensionUrls, features.extensionUrls);
  warnings.push(...features.warnings);
  if (loaded.project?.extensions?.length) {
    const legacy = await loadExtensions(loaded.project.extensions, {
      baseDir: configDir,
      expectUnsandboxed: loaded.project.unsandboxed,
      reportUnmatchedUnsandboxed: false,
    });
    Object.assign(catalog, legacy.catalog);
    Object.assign(extensionUrls, legacy.extensionUrls);
    warnings.push(...legacy.warnings);
  }
  return { catalog, extensionUrls, warnings };
}
