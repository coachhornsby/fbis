// Rights-gated Tennis portraits. A discovered URL or official-site photo is not a grant.
// Use only manually approved R2 assets tied to an exact canonical player identity.
// ATP research IDs use spaces (tennis:atp:research:alex de minaur).
const ID = /^[a-zA-Z0-9:_ -]{1,160}$/;
const KEY = /^tennis\/portraits\/([a-zA-Z0-9:_ -]+)\/([a-zA-Z0-9._-]+)\.(webp|png|jpg|jpeg)$/;
const MIME = new Set(["image/webp", "image/png", "image/jpeg"]);
export const tennisPortraitUrl = id => ID.test(String(id||""))
  ? `/api/tennis-portrait?id=${encodeURIComponent(id)}` : null;
export function verifiedTennisPortrait(row, { now = new Date() } = {}) {
  if (!row || !ID.test(String(row.fbis_player_id||""))) return null;
  if (row.approval_status !== "APPROVED" || Number(row.public_display_allowed) !== 1) return null;
  if (row.display_scope !== "PUBLIC_WEB" || !String(row.rights_evidence_ref||"").trim()) return null;
  const approvedAt = Date.parse(row.approved_at || "");
  const time = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(time) || approvedAt > time) return null;
  if (row.expires_at && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= time)) return null;
  const key = String(row.asset_key||"");
  const match = KEY.exec(key);
  if (!match || match[1] !== row.fbis_player_id || !MIME.has(row.content_type)) return null;
  if (row.content_type === "image/webp" && match[3] !== "webp") return null;
  if (row.content_type === "image/png" && match[3] !== "png") return null;
  if (row.content_type === "image/jpeg" && !["jpg","jpeg"].includes(match[3])) return null;
  return {
    playerId: row.fbis_player_id, url: tennisPortraitUrl(row.fbis_player_id),
    assetKey: key, contentType: row.content_type,
    credit: row.attribution_text || null,
    sourceUrl: /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(row.source_reference||"") ? row.source_reference : null,
    licenseUrl: /^https:\/\/creativecommons\.org\/(licenses\/|publicdomain\/zero\/)/i.test(row.rights_evidence_ref||"") ? row.rights_evidence_ref : null,
    expiresAt: row.expires_at || null,
  };
}
export async function approvedTennisPortraits(db, playerIds, opts = {}) {
  const ids = [...new Set((playerIds||[]).map(String).filter(id=>ID.test(id)))].slice(0,20);
  const found = new Map();
  if (!db?.prepare || ids.length === 0) return found;
  try {
    const placeholders = ids.map(()=>"?").join(",");
    const result = await db.prepare(`SELECT fbis_player_id,asset_key,content_type,approval_status,public_display_allowed,display_scope,rights_evidence_ref,source_reference,approved_at,expires_at,attribution_text
      FROM tennis_player_portraits WHERE fbis_player_id IN (${placeholders})`).bind(...ids).all();
    for (const row of result?.results||[]) {
      const approved = verifiedTennisPortrait(row,opts);
      if (approved) found.set(approved.playerId,approved);
    }
  } catch {
    // Migration not yet applied or temporary D1 error: fail closed to silhouettes.
  }
  return found;
}
