-- Research-only canonical identity bridge. Never infer settlement/trading eligibility.
-- One immutable exact-name mapping per tour+source ID and canonical player.
CREATE TABLE IF NOT EXISTS tennis_free_player_identity_links (
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 provider TEXT NOT NULL CHECK(provider='TENNISMYLIFE'),
 source_player_id TEXT NOT NULL,
 fbis_player_id TEXT NOT NULL REFERENCES tennis_players(fbis_player_id),
 source_name TEXT NOT NULL,
 canonical_name TEXT NOT NULL,
 match_method TEXT NOT NULL CHECK(match_method='TOUR_UNIQUE_EXACT_FULL_NAME'),
 source_match_rows INTEGER NOT NULL CHECK(source_match_rows>0),
 first_source_observed_at TEXT NOT NULL,
 linked_at TEXT NOT NULL,
 contract_trading_authorized INTEGER NOT NULL DEFAULT 0 CHECK(contract_trading_authorized=0),
 PRIMARY KEY(tour,source_player_id),
 UNIQUE(tour,fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_free_identity_fbis
 ON tennis_free_player_identity_links(tour,fbis_player_id);
CREATE TRIGGER IF NOT EXISTS tennis_free_identity_immutable_update
 BEFORE UPDATE ON tennis_free_player_identity_links
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_IDENTITY'); END;
CREATE TRIGGER IF NOT EXISTS tennis_free_identity_immutable_delete
 BEFORE DELETE ON tennis_free_player_identity_links
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_IDENTITY'); END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
 VALUES('0126_tennis_current_identity_links',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
