-- Research-only ATP identity seeding from the existing, dated supplemental player bank.
-- Never represent secondary match archives as ATP official records.
-- Do not overwrite any existing canonical player, official source mapping or headshot.
-- Idempotent and only accepts unambiguous normalized player keys and source IDs.
-- Active library: only seed ATP research identities that carry a current bank rank.
INSERT INTO tennis_players (
 fbis_player_id,tour,canonical_name,normalized_name,sex,active_state,
 current_rank,official_source,official_source_player_id,official_source_priority,
 official_effective_at,official_observed_at,created_at,updated_at
)
SELECT
 'tennis:atp:research:' || b.player_key,'atp',b.player_name,b.player_key,'M','RANKED_ACTIVE',
 b.current_rank,'FBIS_SUPPLEMENTAL_RESEARCH',NULL,1,
 b.source_as_of,b.updated_at,b.updated_at,b.updated_at
FROM tennis_player_bank b
WHERE b.tour='atp'
 AND b.current_rank IS NOT NULL AND b.current_rank > 0
 AND length(b.player_key)>3 AND length(b.player_name)>3
 AND instr(trim(b.player_key),' ')>0
 AND b.player_key=lower(trim(b.player_key))
 AND b.player_key NOT GLOB '*[^a-z0-9 ]*'
 AND b.source_as_of IS NOT NULL
 AND (SELECT COUNT(*) FROM tennis_player_bank other
      WHERE other.tour='atp' AND other.player_key=b.player_key)=1
 AND NOT EXISTS (SELECT 1 FROM tennis_players p
                 WHERE p.tour='atp' AND p.normalized_name=b.player_key)
 AND NOT EXISTS (SELECT 1 FROM tennis_players p
                 WHERE p.fbis_player_id='tennis:atp:research:' || b.player_key);

-- Keep existing ATP research rows aligned with active/ranked library membership.
UPDATE tennis_players
SET active_state = CASE
      WHEN current_rank IS NOT NULL AND current_rank > 0 THEN 'RANKED_ACTIVE'
      ELSE 'LIBRARY_INACTIVE'
    END,
    updated_at = datetime('now')
WHERE tour = 'atp'
  AND official_source = 'FBIS_SUPPLEMENTAL_RESEARCH';
