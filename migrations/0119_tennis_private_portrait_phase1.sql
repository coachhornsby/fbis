-- FBIS Tennis private portrait Phase 1 (2026-10-21).
-- Freeze EXACTLY the validated Tennis Abstract ATP 559 / WTA 515 cohort.
-- No ATP/WTA photo is imported, served, or approved by this migration.
-- User reports conditional private-use permission; documentary evidence is NOT on file.
CREATE TABLE IF NOT EXISTS tennis_private_portrait_cohort_runs (
 cohort_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 report_date TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 source_url TEXT NOT NULL,
 player_count INTEGER NOT NULL,
 retrieved_at TEXT NOT NULL,
 locked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(cohort_id,tour),
 UNIQUE(tour,report_date,source_hash)
);
CREATE TABLE IF NOT EXISTS tennis_private_portrait_cohort_members (
 cohort_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 player_key TEXT NOT NULL,
 player_name TEXT NOT NULL,
 elo_rank INTEGER NOT NULL,
 fbis_player_id TEXT,
 identity_status TEXT NOT NULL CHECK(identity_status IN ('MATCHED','UNMATCHED','AMBIGUOUS')),
 portrait_stage TEXT NOT NULL DEFAULT 'NOT_ACQUIRED'
   CHECK(portrait_stage IN ('NOT_ACQUIRED','SOURCE_FOUND','PRIVATE_IMPORT_PENDING','PRIVATE_IMPORTED','REVIEW_REQUIRED')),
 source_reference TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(cohort_id,tour,player_key),
 FOREIGN KEY(cohort_id,tour) REFERENCES tennis_private_portrait_cohort_runs(cohort_id,tour)
);
CREATE INDEX IF NOT EXISTS idx_tennis_private_cohort_player ON tennis_private_portrait_cohort_members(tour,fbis_player_id);
CREATE INDEX IF NOT EXISTS idx_tennis_private_cohort_status ON tennis_private_portrait_cohort_members(cohort_id,tour,identity_status,portrait_stage);
CREATE TABLE IF NOT EXISTS tennis_private_portrait_policy (
 tour TEXT PRIMARY KEY CHECK(tour IN ('atp','wta')),
 cohort_id TEXT NOT NULL,
 media_source TEXT NOT NULL CHECK(media_source IN ('ATP_OFFICIAL','WTA_OFFICIAL')),
 conditional_rights_claim TEXT NOT NULL DEFAULT 'USER_REPORTED_PRIVATE_PROJECT_USE_ONLY',
 rights_evidence_ref TEXT,
 rights_verification TEXT NOT NULL DEFAULT 'EVIDENCE_REQUIRED'
   CHECK(rights_verification IN ('EVIDENCE_REQUIRED','EVIDENCE_UNDER_REVIEW','DOCUMENTED_PRIVATE_USE')),
 access_verification TEXT NOT NULL DEFAULT 'PUBLIC_OR_UNVERIFIED'
   CHECK(access_verification IN ('PUBLIC_OR_UNVERIFIED','VERIFIED_PRIVATE_ACCESS')),
 display_scope TEXT NOT NULL DEFAULT 'PRIVATE_ONLY' CHECK(display_scope='PRIVATE_ONLY'),
 public_display_allowed INTEGER NOT NULL DEFAULT 0 CHECK(public_display_allowed=0),
 activation_state TEXT NOT NULL DEFAULT 'BLOCKED'
   CHECK(activation_state IN ('BLOCKED','PRIVATE_IMPORT_ALLOWED')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(cohort_id,tour) REFERENCES tennis_private_portrait_cohort_runs(cohort_id,tour),
 CHECK (activation_state='BLOCKED' OR (
   rights_verification='DOCUMENTED_PRIVATE_USE' AND
   length(trim(COALESCE(rights_evidence_ref,'')))>0 AND
   access_verification='VERIFIED_PRIVATE_ACCESS'
 ))
);
-- A deterministic, version-pinned lock prevents a later refresh silently
-- swapping the user's explicitly chosen 1,074 athletes.
INSERT OR IGNORE INTO tennis_private_portrait_cohort_runs
(cohort_id,tour,report_date,source_hash,source_url,player_count,retrieved_at)
SELECT 'tennis-elo-private-20261019-1074',r.tour,r.report_date,r.source_hash,
       r.source_url,r.player_count,r.retrieved_at
FROM tennis_abstract_elo_runs r
WHERE r.report_date='2026-10-19' AND r.research_only=1 AND r.can_authorize_wager=0
 AND ((r.tour='atp' AND r.player_count=559 AND r.source_hash='8e17d8cc26cc96bbf9d03f506adf788d6c172ff310a50583d6da39d7c0dc26f1')
   OR (r.tour='wta' AND r.player_count=515 AND r.source_hash='ffe2e714a810da20a0f2107f14b85d87e52de50101d4bf931e3e53970d796c6b'))
 AND (SELECT COUNT(*) FROM tennis_abstract_elo_players p
      WHERE p.tour=r.tour AND p.report_date=r.report_date AND p.source_hash=r.source_hash)=r.player_count;
INSERT OR IGNORE INTO tennis_private_portrait_cohort_members
(cohort_id,tour,player_key,player_name,elo_rank,fbis_player_id,identity_status)
SELECT c.cohort_id,p.tour,p.player_key,p.player_name,p.elo_rank,
 CASE WHEN (SELECT COUNT(*) FROM tennis_players t
            WHERE t.tour=p.tour AND t.normalized_name=p.player_key)=1
      THEN (SELECT t.fbis_player_id FROM tennis_players t
            WHERE t.tour=p.tour AND t.normalized_name=p.player_key LIMIT 1)
      ELSE NULL END,
 CASE WHEN (SELECT COUNT(*) FROM tennis_players t
            WHERE t.tour=p.tour AND t.normalized_name=p.player_key)=1 THEN 'MATCHED'
      WHEN (SELECT COUNT(*) FROM tennis_players t
            WHERE t.tour=p.tour AND t.normalized_name=p.player_key)=0 THEN 'UNMATCHED'
      ELSE 'AMBIGUOUS' END
FROM tennis_abstract_elo_players p
JOIN tennis_private_portrait_cohort_runs c
 ON c.tour=p.tour AND c.report_date=p.report_date AND c.source_hash=p.source_hash
WHERE c.cohort_id='tennis-elo-private-20261019-1074';
INSERT OR IGNORE INTO tennis_private_portrait_policy
(tour,cohort_id,media_source,rights_evidence_ref,rights_verification,access_verification,activation_state)
VALUES
('atp','tennis-elo-private-20261019-1074','ATP_OFFICIAL',NULL,'EVIDENCE_REQUIRED','PUBLIC_OR_UNVERIFIED','BLOCKED'),
('wta','tennis-elo-private-20261019-1074','WTA_OFFICIAL',NULL,'EVIDENCE_REQUIRED','PUBLIC_OR_UNVERIFIED','BLOCKED');
-- Source-set membership is immutable; identity reconciliation may update the
-- identity fields without changing the 559/515 source roster.
CREATE TRIGGER IF NOT EXISTS tennis_private_cohort_members_immutable_update
BEFORE UPDATE ON tennis_private_portrait_cohort_members
WHEN NEW.cohort_id<>OLD.cohort_id OR NEW.tour<>OLD.tour OR
 NEW.player_key<>OLD.player_key OR NEW.player_name<>OLD.player_name OR
 NEW.elo_rank<>OLD.elo_rank
BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_COHORT_SOURCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS tennis_private_cohort_members_no_delete
BEFORE DELETE ON tennis_private_portrait_cohort_members
BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_COHORT_MEMBERS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS tennis_private_cohort_runs_immutable
BEFORE UPDATE ON tennis_private_portrait_cohort_runs
BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_COHORT_RUN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS tennis_private_cohort_runs_no_delete
BEFORE DELETE ON tennis_private_portrait_cohort_runs
BEGIN SELECT RAISE(ABORT,'TENNIS_PRIVATE_COHORT_RUN_IMMUTABLE'); END;
-- Official source images are never publicly displayable under the conditional grant.
-- Even a valid R2 asset cannot be marked approved until documented rights and
-- verified private access are recorded. Commons/public-license assets are unaffected.
CREATE TRIGGER IF NOT EXISTS tennis_official_photo_private_insert
BEFORE INSERT ON tennis_player_portraits
WHEN NEW.source_name IN ('ATP_OFFICIAL','WTA_OFFICIAL')
BEGIN
 SELECT CASE WHEN NEW.display_scope<>'PRIVATE_ONLY' OR NEW.public_display_allowed<>0
 THEN RAISE(ABORT,'OFFICIAL_TENNIS_PORTRAITS_PRIVATE_ONLY') END;
 SELECT CASE WHEN NEW.approval_status='APPROVED' AND NOT EXISTS (
  SELECT 1 FROM tennis_private_portrait_policy p
  JOIN tennis_players tp ON tp.fbis_player_id=NEW.fbis_player_id
  JOIN tennis_private_portrait_cohort_members m
   ON m.cohort_id=p.cohort_id AND m.tour=tp.tour AND m.fbis_player_id=tp.fbis_player_id
  WHERE p.tour=tp.tour AND p.media_source=NEW.source_name
    AND p.activation_state='PRIVATE_IMPORT_ALLOWED'
    AND p.rights_verification='DOCUMENTED_PRIVATE_USE'
    AND p.access_verification='VERIFIED_PRIVATE_ACCESS'
    AND length(trim(COALESCE(p.rights_evidence_ref,'')))>0
 ) THEN RAISE(ABORT,'PRIVATE_TENNIS_RIGHTS_NOT_ACTIVATED') END;
END;
CREATE TRIGGER IF NOT EXISTS tennis_official_photo_private_update
BEFORE UPDATE ON tennis_player_portraits
WHEN NEW.source_name IN ('ATP_OFFICIAL','WTA_OFFICIAL')
BEGIN
 SELECT CASE WHEN NEW.display_scope<>'PRIVATE_ONLY' OR NEW.public_display_allowed<>0
 THEN RAISE(ABORT,'OFFICIAL_TENNIS_PORTRAITS_PRIVATE_ONLY') END;
 SELECT CASE WHEN NEW.approval_status='APPROVED' AND NOT EXISTS (
  SELECT 1 FROM tennis_private_portrait_policy p
  JOIN tennis_players tp ON tp.fbis_player_id=NEW.fbis_player_id
  JOIN tennis_private_portrait_cohort_members m
   ON m.cohort_id=p.cohort_id AND m.tour=tp.tour AND m.fbis_player_id=tp.fbis_player_id
  WHERE p.tour=tp.tour AND p.media_source=NEW.source_name
    AND p.activation_state='PRIVATE_IMPORT_ALLOWED'
    AND p.rights_verification='DOCUMENTED_PRIVATE_USE'
    AND p.access_verification='VERIFIED_PRIVATE_ACCESS'
    AND length(trim(COALESCE(p.rights_evidence_ref,'')))>0
 ) THEN RAISE(ABORT,'PRIVATE_TENNIS_RIGHTS_NOT_ACTIVATED') END;
END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0119_tennis_private_portrait_phase1',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
