-- Repair residual zero-as-unknown values from the first official WTA profile shard.
-- These nullable fields were not supplied by the audited WTA profile contract and
-- must remain NULL rather than fabricated zeroes.

UPDATE tennis_players
SET career_high_rank=NULL
WHERE tour='wta'
  AND official_source='WTA_OFFICIAL'
  AND career_high_rank=0;

UPDATE tennis_players
SET career_wins=NULL
WHERE tour='wta'
  AND official_source='WTA_OFFICIAL'
  AND career_wins=0;

UPDATE tennis_players
SET career_losses=NULL
WHERE tour='wta'
  AND official_source='WTA_OFFICIAL'
  AND career_losses=0;

UPDATE tennis_players
SET titles=NULL
WHERE tour='wta'
  AND official_source='WTA_OFFICIAL'
  AND titles=0;

UPDATE tennis_players
SET prize_money_usd=NULL
WHERE tour='wta'
  AND official_source='WTA_OFFICIAL'
  AND prize_money_usd=0;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0081_tennis_wta_official_zero_cleanup', datetime('now'));
