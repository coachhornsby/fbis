-- Repair null semantics for official WTA canonical player fields.
-- Zero was used as a transport fallback for absent nullable values in the initial shard.

UPDATE tennis_players
SET current_rank=NULL
WHERE tour='wta' AND official_source='WTA_OFFICIAL' AND current_rank=0;

UPDATE tennis_players
SET ranking_points=NULL
WHERE tour='wta' AND official_source='WTA_OFFICIAL' AND ranking_points=0 AND current_rank IS NULL;

UPDATE tennis_players
SET height_cm=NULL
WHERE tour='wta' AND official_source='WTA_OFFICIAL' AND height_cm=0;

UPDATE tennis_players
SET weight_kg=NULL
WHERE tour='wta' AND official_source='WTA_OFFICIAL' AND weight_kg=0;

UPDATE tennis_players
SET turned_pro_year=NULL
WHERE tour='wta' AND official_source='WTA_OFFICIAL' AND turned_pro_year=0;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0074_tennis_wta_null_semantics', datetime('now'));
