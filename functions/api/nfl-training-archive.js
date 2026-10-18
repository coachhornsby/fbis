/**
 * Durable R2 archive for the NFL-PRO training CSV + manifest.
 * Research reproducibility only — never authorizes wagers.
 */
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const PREFIX = "nfl/training/";
const LATEST_MANIFEST = `${PREFIX}latest-manifest.json`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequest(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  const bucket = context.env.ARCHIVE;
  if (!bucket) return json({ ok: false, error: "archive-binding-missing" }, 500);

  const url = new URL(context.request.url);
  const keyParam = url.searchParams.get("key");

  if (context.request.method === "GET") {
    if (url.searchParams.get("manifest") === "1" || keyParam === "manifest") {
      const obj = await bucket.get(LATEST_MANIFEST);
      if (!obj) return json({ ok: false, error: "manifest-not-found", key: LATEST_MANIFEST }, 404);
      const text = await obj.text();
      let body;
      try { body = JSON.parse(text); } catch { return json({ ok: false, error: "manifest-invalid-json" }, 500); }
      return json({ ok: true, key: LATEST_MANIFEST, manifest: body });
    }
    const key = keyParam || null;
    if (!key || !key.startsWith(PREFIX) || key.includes("..")) {
      return json({ ok: false, error: "key-required", hint: "pass ?key=nfl/training/..." }, 400);
    }
    const obj = await bucket.get(key);
    if (!obj) return json({ ok: false, error: "not-found", key }, 404);
    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "no-store",
        "x-r2-key": key,
      },
    });
  }

  if (context.request.method === "PUT") {
    const kind = url.searchParams.get("kind") || "object";
    const bytes = await context.request.arrayBuffer();
    if (kind === "manifest") {
      if (bytes.byteLength < 32 || bytes.byteLength > 200_000) {
        return json({ ok: false, error: "manifest-size-invalid" }, 400);
      }
      let manifest;
      try { manifest = JSON.parse(new TextDecoder().decode(bytes)); } catch {
        return json({ ok: false, error: "invalid-json" }, 400);
      }
      if (!manifest?.sha256 || !manifest?.objectKey || !manifest?.bytes) {
        return json({ ok: false, error: "manifest-shape-invalid" }, 400);
      }
      if (!String(manifest.objectKey).startsWith(PREFIX)) {
        return json({ ok: false, error: "object-key-prefix-invalid" }, 400);
      }
      const versioned = `${PREFIX}manifests/${manifest.sha256.slice(0, 16)}-${Date.now()}.json`;
      await bucket.put(versioned, bytes, { httpMetadata: { contentType: "application/json" } });
      await bucket.put(LATEST_MANIFEST, bytes, { httpMetadata: { contentType: "application/json" } });
      return json({
        ok: true,
        latestManifestKey: LATEST_MANIFEST,
        versionedManifestKey: versioned,
        objectKey: manifest.objectKey,
        sha256: manifest.sha256,
        bytes: manifest.bytes,
        governance: { researchOnly: true, canAuthorizeWager: false },
      }, 201);
    }

    const sha = url.searchParams.get("sha256") || "";
    if (!/^[a-f0-9]{64}$/i.test(sha)) return json({ ok: false, error: "sha256-required" }, 400);
    if (bytes.byteLength < 1000) return json({ ok: false, error: "object-too-small" }, 400);
    const objectKey = `${PREFIX}datasets/${sha.toLowerCase()}.csv`;
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: {
        sha256: sha.toLowerCase(),
        uploadedAt: new Date().toISOString(),
        source: "nfl-training-archive",
      },
    });
    return json({
      ok: true,
      objectKey,
      bytes: bytes.byteLength,
      sha256: sha.toLowerCase(),
      governance: { researchOnly: true, canAuthorizeWager: false },
    }, 201);
  }

  return json({ ok: false, error: "method-not-allowed" }, 405);
}
