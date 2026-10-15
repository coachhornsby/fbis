/**
 * Operator-only: replace an already-APPROVED tennis portrait JPEG/PNG with a
 * reviewed transparent WebP cutout. Does not import new players or grant rights.
 * Requires HARVEST_SECRET. Bytes must match SHA-256 and image/webp signature.
 */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const ID = /^tennis:(?:wta|atp):[a-zA-Z0-9:_ -]{1,120}$/;
const WEBP_RIFF = (bytes) => bytes.length >= 12
  && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  const secret = String(env?.HARVEST_SECRET || "");
  if (secret.length < 24 || request.headers.get("x-harvest-secret") !== secret) {
    return json({ ok: false, reason: "UNAUTHORIZED" }, 403);
  }
  if (!env?.DB?.prepare || !env?.ARCHIVE?.put) return json({ ok: false, reason: "STORAGE_UNAVAILABLE" }, 503);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, reason: "INVALID_BODY" }, 400); }

  const playerId = String(input?.playerId || "");
  if (!ID.test(playerId)) return json({ ok: false, reason: "INVALID_PLAYER_ID" }, 400);
  if (typeof input?.dataBase64 !== "string" || !/^[a-f0-9]{64}$/.test(String(input?.imageSha256 || ""))) {
    return json({ ok: false, reason: "SOURCE_BYTES_INVALID" }, 422);
  }
  if (input.dataBase64.length > 8 * 1024 * 1024) return json({ ok: false, reason: "IMAGE_TOO_LARGE" }, 413);

  const existing = await env.DB.prepare(`
    SELECT fbis_player_id, asset_key, content_type, approval_status, public_display_allowed, display_scope
    FROM tennis_player_portraits WHERE fbis_player_id=?
  `).bind(playerId).first();
  if (!existing) return json({ ok: false, reason: "PORTRAIT_NOT_REGISTERED" }, 404);
  if (existing.approval_status !== "APPROVED" || Number(existing.public_display_allowed) !== 1 || existing.display_scope !== "PUBLIC_WEB") {
    return json({ ok: false, reason: "PORTRAIT_NOT_PUBLICLY_APPROVED" }, 409);
  }

  let bytes;
  try {
    const binary = atob(input.dataBase64);
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return json({ ok: false, reason: "BASE64_DECODE_FAILED" }, 422);
  }
  if (bytes.byteLength < 400 || bytes.byteLength > 6 * 1024 * 1024 || !WEBP_RIFF(bytes)) {
    return json({ ok: false, reason: "NOT_VALID_WEBP" }, 422);
  }
  const hex = await sha256Hex(bytes);
  if (hex !== input.imageSha256) return json({ ok: false, reason: "IMAGE_CHECKSUM_MISMATCH" }, 422);

  const key = `tennis/portraits/${playerId}/approved-cutout.webp`;
  const now = new Date().toISOString();
  await env.ARCHIVE.put(key, bytes, {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: {
      source: "FBIS_REVIEWED_CUTOUT",
      playerId,
      priorAssetKey: String(existing.asset_key || ""),
      reviewedAt: now,
    },
  });

  const write = await env.DB.prepare(`
    UPDATE tennis_player_portraits
    SET asset_key=?, content_type='image/webp', reviewed_by=?, updated_at=?
    WHERE fbis_player_id=? AND approval_status='APPROVED' AND public_display_allowed=1
  `).bind(key, "FBIS_CUTOUT_REVIEW_20261015", now, playerId).run();

  if (Number(write?.meta?.changes || 0) !== 1) {
    return json({ ok: false, reason: "DATABASE_UPDATE_NOT_CONFIRMED" }, 503);
  }

  return json({
    ok: true,
    status: "CUTOUT_PUBLISHED",
    playerId,
    assetKey: key,
    contentType: "image/webp",
    bytes: bytes.byteLength,
    priorAssetKey: existing.asset_key,
    canAuthorizeWager: false,
  });
}
