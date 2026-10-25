/** Point-in-time player serve/return intelligence from immutable source observations.
 * NO estimates before FBIS first observed the source, no retroactive backtest use.
 */
import {deriveFreeTennisStatProfile} from './tennisFreeStatProfile.js';
export async function loadCanonicalFreeTennisFeatures(db,{
 playerId,asOf=new Date(),maxObservations=1600
}={}){
 const at=asOf instanceof Date?asOf.toISOString():asOf;
 if(!db?.prepare||!/^[a-zA-Z0-9:_ -]{1,160}$/.test(playerId||'')||
    !Number.isFinite(Date.parse(at||''))||Date.parse(at)>Date.now()+60000)
  throw Error('PLAYER_ID_OR_ASOF_INVALID');
 const links=(await db.prepare(`SELECT tour,source_player_id,fbis_player_id,linked_at
 FROM tennis_free_player_identity_links
 WHERE fbis_player_id=? AND linked_at<?`).bind(playerId,at).all()).results||[];
 if(links.length!==1)return {ok:false,reason:links.length?'PLAYER_IDENTITY_AMBIGUOUS':'EXACT_IDENTITY_LINK_UNAVAILABLE',
  playerId,asOf:at,contractTradingAuthorized:false};
 const link=links[0];
 const observations=(await db.prepare(`WITH ranked AS (
 SELECT parsed_json,observed_at,source_event_key,observation_key,source_row_checksum,
 ROW_NUMBER() OVER (PARTITION BY source_event_key
   ORDER BY observed_at DESC,observation_key DESC) rn
 FROM tennis_free_current_observations
 WHERE observed_at<? AND json_extract(parsed_json,'$.tour')=?
   AND (json_extract(parsed_json,'$.winnerSourceId')=?
    OR json_extract(parsed_json,'$.loserSourceId')=?)
 )
 SELECT parsed_json,observed_at,source_event_key,observation_key,source_row_checksum FROM ranked
 WHERE rn=1 LIMIT ?`)
 .bind(at,link.tour,link.source_player_id,link.source_player_id,
  maxObservations+1).all()).results||[];
 if(observations.length>maxObservations)throw Error('HISTORICAL_RESEARCH_EVIDENCE_LIMIT');
 const rows=[];
 for(const observation of observations){
  let r;
  try{r=JSON.parse(observation.parsed_json)}catch{throw Error('SOURCE_OBSERVATION_CORRUPT')}
  if(r.tour!==link.tour||
     ![r.winnerSourceId,r.loserSourceId].includes(link.source_player_id))
    throw Error('SOURCE_OBSERVATION_IDENTITY_CONFLICT');
  rows.push({tour:r.tour,surface:r.surface,
   winner_source_id:r.winnerSourceId,loser_source_id:r.loserSourceId,
   winner_stats_json:JSON.stringify(r.winnerStats),
   loser_stats_json:JSON.stringify(r.loserStats),
   source_date_label:r.dateLabel,last_observed_at:observation.observed_at});
 }
 const features=deriveFreeTennisStatProfile(rows,{tour:link.tour,
  sourcePlayerId:link.source_player_id});
 const evidenceRefs=observations.map(o=>({key:o.observation_key,
  eventId:o.source_event_key,observedAt:o.observed_at,rowHash:o.source_row_checksum}));
 return {ok:true,fbisPlayerId:playerId,asOf:at,identityMethod:'TOUR_UNIQUE_EXACT_FULL_NAME',
  identityLinkedAt:link.linked_at,sourceEvidenceRows:observations.length,evidenceRefs,
  researchStats:features,source:'TENNISMYLIFE',
  observedAfterMatchRisk:!features.exactMatchDateVerified,
  safeForHistoricalPreEventOnlyIfObservedBeforeCutoff:true,
  researchOnly:true,contractTradingAuthorized:false};
}
