-- WTA ranked-universe reconciliation, identity review, source audit, and ranking PIT hardening.

DROP INDEX IF EXISTS idx_tennis_rank_unique;
CREATE INDEX IF NOT EXISTS idx_tennis_rank_same_date
  ON tennis_ranking_observations(fbis_player_id, ranking_date, source, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_identity_review_queue (
  review_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  source TEXT NOT NULL,
  source_player_id TEXT,
  source_name TEXT,
  normalized_source_name TEXT,
  issue_type TEXT NOT NULL,
  candidate_fbis_player_ids_json TEXT,
  detail_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_tennis_identity_review_open
  ON tennis_identity_review_queue(tour,source,status,issue_type,last_observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_source_audits (
  audit_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  endpoint_path TEXT NOT NULL,
  http_status INTEGER,
  available INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER,
  earliest_date TEXT,
  latest_date TEXT,
  field_inventory_json TEXT,
  detail_json TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_source_audits_latest
  ON tennis_source_audits(source,tour,endpoint_key,observed_at DESC);

DROP TRIGGER IF EXISTS trg_tennis_players_source_priority;
CREATE TRIGGER trg_tennis_players_source_priority
BEFORE UPDATE OF canonical_name,country_code,date_of_birth,height_cm,weight_kg,handedness,backhand,
  turned_pro_year,coach,official_headshot_url,current_rank,ranking_points,career_high_rank,
  career_wins,career_losses,titles,prize_money_usd,official_source,official_source_player_id,
  official_source_priority
ON tennis_players
WHEN NEW.official_source_priority < OLD.official_source_priority
BEGIN
  SELECT RAISE(ABORT,'tennis official source priority violation');
END;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0076_tennis_wta_ranked_reconciliation', datetime('now'));
