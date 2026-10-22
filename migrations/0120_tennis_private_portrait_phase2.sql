-- Tennis private portrait Phase 2: canonical identity reconciliation and SOURCE REFERENCES ONLY.
-- NO ATP/WTA photo bytes, no license activation, and no official ID invention.
-- All new unmatched player records are explicitly RESEARCH_ONLY identity stubs.
CREATE TABLE IF NOT EXISTS tennis_private_portrait_source_references (
 cohort_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 player_key TEXT NOT NULL,
 fbis_player_id TEXT NOT NULL,
 official_id_provider TEXT CHECK(official_id_provider IN ('ATP_OFFICIAL','WTA_OFFICIAL')),
 official_player_id TEXT,
 official_id_status TEXT NOT NULL
   CHECK(official_id_status IN ('LINKED_FROM_OFFICIAL_INGEST','NOT_VERIFIED')),
 official_profile_candidate_url TEXT,
 profile_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED'
   CHECK(profile_status IN ('NOT_VERIFIED','OFFICIAL_ID_BASED_CANDIDATE','SOURCE_URL_VERIFIED')),
 headshot_candidate_url TEXT,
 headshot_candidate_source TEXT,
 headshot_status TEXT NOT NULL DEFAULT 'NO_OFFICIAL_IMAGE_VERIFIED'
   CHECK(headshot_status IN ('NO_OFFICIAL_IMAGE_VERIFIED','THIRD_PARTY_URL_CANDIDATE','OFFICIAL_IMAGE_SOURCE_VERIFIED')),
 headshot_evidence_ref TEXT,
 private_image_imported INTEGER NOT NULL DEFAULT 0 CHECK(private_image_imported=0),
 public_display_allowed INTEGER NOT NULL DEFAULT 0 CHECK(public_display_allowed=0),
 noted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(cohort_id,tour,player_key),
 FOREIGN KEY(cohort_id,tour,player_key)
 REFERENCES tennis_private_portrait_cohort_members(cohort_id,tour,player_key),
 CHECK((official_id_status='LINKED_FROM_OFFICIAL_INGEST' AND official_id_provider IS NOT NULL AND
   official_player_id IS NOT NULL) OR (official_id_status='NOT_VERIFIED' AND official_player_id IS NULL)),
 CHECK(headshot_status<>'OFFICIAL_IMAGE_SOURCE_VERIFIED' OR
   (length(trim(COALESCE(headshot_evidence_ref,'')))>0 AND
    headshot_candidate_url LIKE 'https://%'))
);
CREATE INDEX IF NOT EXISTS idx_tennis_private_references_identity
  ON tennis_private_portrait_source_references(tour,official_id_status,profile_status,headshot_status);
-- Ingest locked sources into the existing player-bank namespace, NEVER relabeling a
-- research-only player as ATP_OFFICIAL or WTA_OFFICIAL.
-- Exact source key uniqueness and tour identity are checked before insertion.
INSERT OR IGNORE INTO tennis_players(
 fbis_player_id,tour,canonical_name,normalized_name,active_state,
 official_source,official_source_player_id,official_source_priority,
 official_effective_at,official_observed_at,created_at,updated_at)
SELECT 'tennis:'||m.tour||':ta20261019:'||replace(m.player_key,' ','-'),
 m.tour,m.player_name,m.player_key,'RESEARCH_TRACKED',
 'TENNIS_ABSTRACT_ROSTER_RESEARCH',NULL,1,'2026-10-19',c.retrieved_at,
 strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM tennis_private_portrait_cohort_members m
JOIN tennis_private_portrait_cohort_runs c ON c.cohort_id=m.cohort_id AND c.tour=m.tour
WHERE m.cohort_id='tennis-elo-private-20261019-1074'
 AND m.identity_status='UNMATCHED'
 AND NOT EXISTS (
  SELECT 1 FROM tennis_players t WHERE t.tour=m.tour AND t.normalized_name=m.player_key
 );
-- Never force a mismatch to an existing canonical record or conceal collisions.
UPDATE tennis_private_portrait_cohort_members
SET fbis_player_id=(SELECT t.fbis_player_id FROM tennis_players t
                    WHERE t.tour=tennis_private_portrait_cohort_members.tour
                    AND t.normalized_name=tennis_private_portrait_cohort_members.player_key LIMIT 1),
 identity_status='MATCHED',
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE cohort_id='tennis-elo-private-20261019-1074'
 AND identity_status='UNMATCHED'
 AND (SELECT COUNT(*) FROM tennis_players t
      WHERE t.tour=tennis_private_portrait_cohort_members.tour
      AND t.normalized_name=tennis_private_portrait_cohort_members.player_key)=1;
-- One reference record per cohort athlete; no claimed official photo verification.
INSERT OR IGNORE INTO tennis_private_portrait_source_references
(cohort_id,tour,player_key,fbis_player_id,official_id_provider,official_player_id,
 official_id_status,official_profile_candidate_url,profile_status,
 headshot_candidate_url,headshot_candidate_source,headshot_status)
SELECT m.cohort_id,m.tour,m.player_key,m.fbis_player_id,
 CASE WHEN s.source_player_id IS NOT NULL THEN s.provider ELSE NULL END,
 s.source_player_id,
 CASE WHEN s.source_player_id IS NOT NULL THEN 'LINKED_FROM_OFFICIAL_INGEST' ELSE 'NOT_VERIFIED' END,
 CASE WHEN m.tour='wta' AND s.source_player_id IS NOT NULL AND s.provider='WTA_OFFICIAL'
      AND s.source_player_id GLOB '[0-9]*'
   THEN 'https://www.wtatennis.com/players/'||s.source_player_id||'/'||
      replace(m.player_key,' ','-') ELSE NULL END,
 CASE WHEN m.tour='wta' AND s.source_player_id IS NOT NULL AND s.provider='WTA_OFFICIAL'
    THEN 'OFFICIAL_ID_BASED_CANDIDATE' ELSE 'NOT_VERIFIED' END,
 CASE WHEN m.tour='atp' AND p.official_headshot_source='PRIZEPICKS_FEED'
   AND lower(p.official_headshot_url) LIKE 'https://www.atptour.com/%'
   THEN p.official_headshot_url ELSE NULL END,
 CASE WHEN m.tour='atp' AND p.official_headshot_source='PRIZEPICKS_FEED'
   AND lower(p.official_headshot_url) LIKE 'https://www.atptour.com/%'
   THEN 'PRIZEPICKS_FEED' ELSE NULL END,
 CASE WHEN m.tour='atp' AND p.official_headshot_source='PRIZEPICKS_FEED'
   AND lower(p.official_headshot_url) LIKE 'https://www.atptour.com/%'
   THEN 'THIRD_PARTY_URL_CANDIDATE' ELSE 'NO_OFFICIAL_IMAGE_VERIFIED' END
FROM tennis_private_portrait_cohort_members m
JOIN tennis_players p ON p.fbis_player_id=m.fbis_player_id AND p.tour=m.tour
LEFT JOIN tennis_player_source_ids s ON s.fbis_player_id=m.fbis_player_id
 AND s.provider=CASE WHEN m.tour='wta' THEN 'WTA_OFFICIAL' ELSE 'ATP_OFFICIAL' END
WHERE m.cohort_id='tennis-elo-private-20261019-1074'
 AND m.identity_status='MATCHED'
 AND ((s.source_player_id IS NULL) OR (s.source_player_id<>'' AND
   (SELECT COUNT(*) FROM tennis_player_source_ids sx
    WHERE sx.fbis_player_id=m.fbis_player_id AND sx.provider=s.provider)=1));
-- No migration or future update can turn metadata discovery into private bytes.
CREATE TRIGGER IF NOT EXISTS tennis_private_reference_no_image_activation_insert
 BEFORE INSERT ON tennis_private_portrait_source_references
 WHEN NEW.private_image_imported<>0 OR NEW.public_display_allowed<>0
 BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_IMAGE_NOT_ACTIVATED'); END;
CREATE TRIGGER IF NOT EXISTS tennis_private_reference_no_image_activation_update
 BEFORE UPDATE ON tennis_private_portrait_source_references
 WHEN NEW.private_image_imported<>0 OR NEW.public_display_allowed<>0
 BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_IMAGE_NOT_ACTIVATED'); END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES
 ('0120_tennis_private_portrait_phase2',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
