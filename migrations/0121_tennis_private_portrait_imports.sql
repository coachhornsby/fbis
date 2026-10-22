-- Separate official private-media ledger. No public release and no photo bytes in D1.
CREATE TABLE IF NOT EXISTS tennis_private_portrait_imports (
 cohort_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 player_key TEXT NOT NULL,
 fbis_player_id TEXT NOT NULL,
 official_image_url TEXT NOT NULL,
 asset_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
 byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 300 AND 5242880),
 rights_evidence_ref TEXT NOT NULL CHECK(length(trim(rights_evidence_ref))>0),
 storage_scope TEXT NOT NULL DEFAULT 'PRIVATE_ONLY' CHECK(storage_scope='PRIVATE_ONLY'),
 public_display_allowed INTEGER NOT NULL DEFAULT 0 CHECK(public_display_allowed=0),
 imported_at TEXT NOT NULL,
 PRIMARY KEY(cohort_id,tour,player_key),
 FOREIGN KEY(cohort_id,tour,player_key) REFERENCES tennis_private_portrait_cohort_members(cohort_id,tour,player_key)
);
CREATE INDEX IF NOT EXISTS idx_tennis_private_portrait_imports_player ON tennis_private_portrait_imports(fbis_player_id);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0121_tennis_private_portrait_imports',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
