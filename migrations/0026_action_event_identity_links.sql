-- Durable ACTION ↔ FBIS event identity links (0026).
-- Append/upsert identity only — never mutates immutable market observations.
-- Used when board rematch finds EXACT/HIGH confidence so future loads join
-- by canonical event id without rediscovering the match at display time.

CREATE TABLE IF NOT EXISTS action_event_identity_links (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'ACTION_APIFY',
  provider_event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  canonical_event_id TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  match_reason TEXT,
  source_observation_id TEXT,
  linked_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id, sport)
);

CREATE INDEX IF NOT EXISTS idx_action_identity_canonical
  ON action_event_identity_links (canonical_event_id, sport);

CREATE INDEX IF NOT EXISTS idx_action_identity_provider
  ON action_event_identity_links (provider_event_id, sport);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0026_action_event_identity_links', datetime('now'));
