-- Remove demonstrated ESPN synthetic roster placeholders from the CFB player directory.
-- These rows have canonical_name '- Team', first_name '-', last_name 'Team', and
-- source payload jersey_right='TM'. Preserve all legitimate provider-backed players.

DELETE FROM cfb_roster_observations
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team'
    AND first_name='-'
    AND last_name='Team'
    AND source_json LIKE '%"jersey_right":"TM"%'
);

DELETE FROM cfb_roster_membership
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team'
    AND first_name='-'
    AND last_name='Team'
    AND source_json LIKE '%"jersey_right":"TM"%'
);

DELETE FROM cfb_player_aliases
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team'
    AND first_name='-'
    AND last_name='Team'
    AND source_json LIKE '%"jersey_right":"TM"%'
);

DELETE FROM cfb_player_provider_ids
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team'
    AND first_name='-'
    AND last_name='Team'
    AND source_json LIKE '%"jersey_right":"TM"%'
);

DELETE FROM cfb_canonical_players
WHERE canonical_name='- Team'
  AND first_name='-'
  AND last_name='Team'
  AND source_json LIKE '%"jersey_right":"TM"%';

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0088_cfb_roster_source_placeholder_cleanup',datetime('now'));
