/**
 * Triflare Marketplace sources.
 *
 * `fx vendor add marketplace:@handle/extension@ref` resolves the requested
 * version or dist-tag to a pinned download URL before anything is written.
 * `fx.yml` keeps that URL, and `fx.lock` records the resolved version and
 * digest, so reinstalls and builds never query the registry.
 */
import { VendorError, fetchVendorSource, sha256 } from "./vendor.js";

export const DEFAULT_MARKETPLACE_API = "https://marketplace.sdisk.us/api/v1";

const SOURCE_PATTERN =
  /^marketplace:@([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\/([a-z0-9]{1,64})(?:@([A-Za-z0-9._+-]+))?$/;

/** @param {unknown} source */
export function isMarketplaceSource(source) {
  return /^marketplace:/i.test(String(source));
}

/**
 * Parse `marketplace:@handle/extension@ref`.
 *
 * @param {string} source
 * @returns {{namespace: string, id: string, ref: string, package: string}}
 */
export function parseMarketplaceSource(source) {
  const match = SOURCE_PATTERN.exec(String(source).trim());
  if (!match)
    throw new VendorError(
      `Invalid marketplace source ${JSON.stringify(String(source))}. ` +
        "Use marketplace:@handle/extension@optionalVersionOrDistTag.",
    );
  const [, namespace, id, ref] = match;
  return {
    namespace,
    id,
    ref: ref ?? "latest",
    package: `@${namespace}/${id}`,
  };
}

/** The API root, with `FX_MARKETPLACE_API` available for self-hosted instances. */
export function marketplaceApiBase(apiBase) {
  return String(
    apiBase || process.env.FX_MARKETPLACE_API || DEFAULT_MARKETPLACE_API,
  ).replace(/\/+$/, "");
}

/** Fetch and parse a JSON response, turning failures into VendorError. */
async function fetchJson(url, fetchImpl, label) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function")
    throw new VendorError("global fetch is unavailable");
  let response;
  try {
    response = await fetchFn(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new VendorError(
      `Could not reach Triflare Marketplace for ${label}: ${error.message}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const status = `${response.status} ${response.statusText ?? ""}`.trim();
    const problem =
      response.status === 404
        ? `could not find ${label}`
        : `request for ${label} failed`;
    throw new VendorError(`Triflare Marketplace ${problem}: HTTP ${status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new VendorError(
      `Triflare Marketplace returned invalid JSON for ${label}`,
      { cause: error },
    );
  }
}

/**
 * Resolve a marketplace source to its compiled bytes.
 *
 * The version endpoint accepts a SemVer string, a dist-tag, or `latest`.
 * The downloaded file must match the SHA-256 the registry reports.
 *
 * @param {object} options
 * @param {string} options.source
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiBase]
 */
export async function resolveMarketplaceExtension({
  source,
  fetchImpl,
  apiBase,
}) {
  const parsed = parseMarketplaceSource(source);
  const base = marketplaceApiBase(apiBase);
  const label =
    parsed.ref === "latest"
      ? parsed.package
      : `${parsed.package}@${parsed.ref}`;
  const versionUrl = `${base}/@${parsed.namespace}/${parsed.id}/versions/${encodeURIComponent(
    parsed.ref,
  )}`;
  const info = await fetchJson(versionUrl, fetchImpl, label);
  if (!info || typeof info !== "object" || Array.isArray(info))
    throw new VendorError(
      `Triflare Marketplace returned no version for ${label}`,
    );

  const version = info.version;
  if (typeof version !== "string" || version === "")
    throw new VendorError(
      `Triflare Marketplace returned no version for ${label}`,
    );
  const status = info.status ?? "published";
  if (status !== "published" && status !== "deprecated")
    throw new VendorError(
      `${parsed.package}@${version} is ${status} on Triflare Marketplace; ` +
        "only published versions can be vendored.",
    );

  const downloadUrl = info.dist?.downloadUrl;
  if (typeof downloadUrl !== "string" || downloadUrl === "")
    throw new VendorError(
      `${parsed.package}@${version} has no compiled download on Triflare Marketplace; ` +
        "this extension cannot be vendored.",
    );
  const digest = String(info.dist?.digest ?? "")
    .replace(/^sha256:/i, "")
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest))
    throw new VendorError(
      `${parsed.package}@${version} has no SHA-256 digest on Triflare Marketplace; ` +
        "refusing to vendor an unverifiable download.",
    );

  const downloaded = await fetchVendorSource(downloadUrl, { fetchImpl });
  const actual = sha256(downloaded.buffer);
  if (actual !== digest)
    throw new VendorError(
      `${parsed.package}@${version} did not match the SHA-256 reported by ` +
        `Triflare Marketplace (expected ${digest.slice(0, 12)}…, found ${actual.slice(
          0,
          12,
        )}…).`,
    );

  return {
    ...parsed,
    version,
    status,
    downloadUrl,
    buffer: downloaded.buffer,
    digest: `sha256:${digest}`,
    sha256: actual,
    etag: downloaded.etag,
    lastModified: downloaded.lastModified,
    marketplace: {
      package: parsed.package,
      version,
      ref: parsed.ref,
    },
  };
}
