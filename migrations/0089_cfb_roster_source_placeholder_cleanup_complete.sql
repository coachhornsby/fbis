-- Complete cleanup of demonstrated ESPN synthetic "- Team" player placeholders.
-- The exact impossible name signature is sufficient; jersey fields vary by source row.

DELETE FROM cfb_roster_observations
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team' AND first_name='-' AND last_name='Team'
);

DELETE FROM cfb_roster_membership
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team' AND first_name='-' AND last_name='Team'
);

DELETE FROM cfb_player_aliases
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team' AND first_name='-' AND last_name='Team'
);

DELETE FROM cfb_player_provider_ids
WHERE player_id IN (
  SELECT player_id FROM cfb_canonical_players
  WHERE canonical_name='- Team' AND first_name='-' AND last_name='Team'
);

DELETE FROM cfb_canonical_players
WHERE canonical_name='- Team' AND first_name='-' AND last_name='Team';

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0089_cfb_roster_source_placeholder_cleanup_complete',datetime('now'));
