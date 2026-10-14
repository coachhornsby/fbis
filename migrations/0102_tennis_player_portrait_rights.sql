-- Rights-verified Tennis player portrait catalog; no automatic ATP/WTA acquisition.
-- Each asset must be independently authorized for PUBLIC_WEB before public rendering.
-- Asset bytes live in FBIS ARCHIVE R2 under tennis/portraits/{canonical_id}/{filename}.
CREATE TABLE IF NOT EXISTS tennis_player_portraits (
  fbis_player_id TEXT PRIMARY KEY NOT NULL,
  asset_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/webp','image/png','image/jpeg')),
  source_name TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  attribution_text TEXT,
  display_scope TEXT NOT NULL DEFAULT 'PRIVATE_ONLY' CHECK (display_scope IN ('PRIVATE_ONLY','PUBLIC_WEB')),
  approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING','APPROVED','REVOKED')),
  public_display_allowed INTEGER NOT NULL DEFAULT 0 CHECK (public_display_allowed IN (0,1)),
  rights_evidence_ref TEXT,
  approved_at TEXT,
  expires_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_portraits_authorization
  ON tennis_player_portraits(approval_status,public_display_allowed,expires_at);
INSERT OR IGNORE INTO schema_migrations (id,applied_at)
VALUES ('0102_tennis_player_portrait_rights',datetime('now'));
