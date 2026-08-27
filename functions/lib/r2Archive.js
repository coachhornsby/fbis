/**
 * Optional R2 archive for raw CFBD/CBBD payloads and large artifacts.
 * Compact D1 rows remain required. Missing R2 must not block operational models.
 */

export function r2Bound(env) {
  return Boolean(env?.ARCHIVE?.put && env?.ARCHIVE?.get);
}

export function r2Key({ kind = "raw", source, sport, season, endpoint, partition, hash, name }) {
  const parts = [
    kind,
    source,
    sport,
    season != null ? String(season) : "na",
    endpoint ? String(endpoint).replace(/^\//, "").replace(/\//g, "_") : "obj",
    partition || "all",
    name || `${hash || "unknown"}.json`,
  ];
  return parts.filter(Boolean).join("/");
}

export async function putArchive(env, key, body, { contentType = "application/json" } = {}) {
  if (!r2Bound(env)) return { ok: false, reason: "r2-unbound", key };
  try {
    const payload = typeof body === "string" || body instanceof ArrayBuffer ? body : JSON.stringify(body);
    await env.ARCHIVE.put(key, payload, { httpMetadata: { contentType } });
    return { ok: true, key };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), key };
  }
}

export async function r2PrefixBytes(env, prefix) {
  if (!r2Bound(env)) return { ok: false, reason: "r2-unbound", bytes: 0, objects: 0 };
  try {
    const listed = await env.ARCHIVE.list({ prefix, limit: 1000 });
    let bytes = 0;
    for (const obj of listed.objects || []) bytes += Number(obj.size) || 0;
    return { ok: true, bytes, objects: (listed.objects || []).length, truncated: Boolean(listed.truncated) };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), bytes: 0, objects: 0 };
  }
}

export const R2_SETUP = {
  binding: "ARCHIVE",
  bucket: "fbis-archive",
  wrangler: `[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "fbis-archive"`,
  note: "Create the bucket in the Cloudflare dashboard, add the binding, and redeploy. Operational CFB/CBB models use compact D1 rows and do not require R2.",
};
