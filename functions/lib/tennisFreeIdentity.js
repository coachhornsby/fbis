/** Research identity linkage. Accept only a UNIQUE full-name match within a tour.
 * No fuzzy/last-name guessing, and never edits the canonical player bank.
 */
export const TENNIS_FREE_IDENTITY_METHOD='TOUR_UNIQUE_EXACT_FULL_NAME';
export const TENNIS_FREE_IDENTITY_SQL=`
INSERT OR IGNORE INTO tennis_free_player_identity_links
(tour,provider,source_player_id,fbis_player_id,source_name,canonical_name,
 match_method,source_match_rows,first_source_observed_at,linked_at,contract_trading_authorized)
WITH source_rows AS (
 SELECT tour,winner_source_id AS sid,TRIM(winner_name) AS nm,
 source_event_key AS match_key,first_observed_at AS observed
 FROM tennis_free_current_matches
 UNION ALL
 SELECT tour,loser_source_id AS sid,TRIM(loser_name) AS nm,
 source_event_key AS match_key,first_observed_at AS observed
 FROM tennis_free_current_matches
), source_unique AS (
 SELECT tour,sid,MIN(nm) AS nm,COUNT(*) AS sample_n,MIN(observed) AS first_seen
 FROM source_rows
 GROUP BY tour,sid
 HAVING COUNT(DISTINCT LOWER(nm))=1 AND MIN(nm)<>'' AND sid<>''
), canonical_unique AS (
 SELECT tour,LOWER(TRIM(canonical_name)) AS nm,
 MIN(fbis_player_id) AS fbid, MIN(canonical_name) AS canonical_name
 FROM tennis_players
 GROUP BY tour,LOWER(TRIM(canonical_name))
 HAVING COUNT(*)=1
), candidates AS (
 SELECT s.tour,s.sid,s.nm,s.sample_n,s.first_seen,c.fbid,c.canonical_name
 FROM source_unique s JOIN canonical_unique c
 ON c.tour=s.tour AND c.nm=LOWER(s.nm)
), unambiguous AS (
 SELECT c.* FROM candidates c
 WHERE (SELECT COUNT(*) FROM candidates d
        WHERE d.tour=c.tour AND d.fbid=c.fbid)=1
)
SELECT tour,'TENNISMYLIFE',sid,fbid,nm,canonical_name,
 'TOUR_UNIQUE_EXACT_FULL_NAME',sample_n,first_seen,?,0
FROM unambiguous`;
export async function reconcileFreeTennisIdentities(db,{now=new Date()}={}){
 if(!db?.prepare||!Number.isFinite(+now))throw Error('TENNIS_IDENTITY_DB_OR_CLOCK_MISSING');
 const result=await db.prepare(TENNIS_FREE_IDENTITY_SQL).bind(now.toISOString()).run();
 const rows=(await db.prepare(`
 SELECT t.tour,COUNT(DISTINCT t.sid) sourceIds,
 COUNT(DISTINCT l.source_player_id) linkedIds
 FROM (
   SELECT tour,winner_source_id sid FROM tennis_free_current_matches
   UNION SELECT tour,loser_source_id sid FROM tennis_free_current_matches
 ) t LEFT JOIN tennis_free_player_identity_links l
  ON l.tour=t.tour AND l.source_player_id=t.sid
 GROUP BY t.tour ORDER BY t.tour`).all()).results||[];
 return {ok:true,asOf:now.toISOString(),newLinks:Number(result.meta?.changes??result.changes??0),
  tours:rows.map(x=>({tour:x.tour,sourcePlayerIds:Number(x.sourceIds),
    linkedIds:Number(x.linkedIds),unlinkedIds:Number(x.sourceIds)-Number(x.linkedIds)})),
  method:TENNIS_FREE_IDENTITY_METHOD,
  insufficientIdentityEvidenceFailsClosed:true,
  researchOnly:true,contractTradingAuthorized:false};
}
