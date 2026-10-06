-- Durable Heritage <-> provider competition registry for soccer.
CREATE TABLE IF NOT EXISTS soccer_competition_provider_map (
  heritage_name TEXT PRIMARY KEY,
  heritage_key TEXT,
  canonical_competition_id TEXT,
  provider TEXT NOT NULL DEFAULT 'pitchapi',
  provider_competition_id TEXT,
  provider_name TEXT,
  provider_aliases_json TEXT,
  mapping_source TEXT NOT NULL DEFAULT 'DISCOVERY',
  confidence REAL,
  verified_manual INTEGER NOT NULL DEFAULT 0,
  last_checked TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_soccer_provider_map_provider
  ON soccer_competition_provider_map(provider,provider_competition_id);

INSERT OR IGNORE INTO soccer_competition_provider_map(
  heritage_name,heritage_key,canonical_competition_id,provider,provider_competition_id,provider_name,
  provider_aliases_json,mapping_source,confidence,verified_manual,last_checked,created_at,updated_at
)
SELECT
  heritage_name,heritage_key,heritage_key,'pitchapi',pitch_league_id,pitch_league_name,
  json_array(pitch_league_name),
  CASE WHEN match_method='exact' THEN 'AUTO_EXACT' ELSE 'AUTO_HIGH_CONFIDENCE' END,
  match_score,0,last_discovered_at,COALESCE(last_discovered_at,datetime('now')),datetime('now')
FROM soccer_competition_coverage
WHERE discovery_status='MATCHED' AND pitch_league_id IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0062_soccer_provider_mapping_registry',datetime('now'));
