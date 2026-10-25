/**
 * NBA-only canonical PRETIP player snapshots.
 * Game/model creation clocks must BOTH precede verified game start.
 * This is a dated research reference, NEVER an in-play projection or price.
 * Uses the already-approved NBA sport DB through the strict owner resolver.
 */
import { resolveNbaResearchOwnerDb } from './nbaResearchOwnerDb.js';

const canonicalTeam = value => ({ SA:'SAS', NY:'NYK', GS:'GSW', NO:'NOP' }[String(value||'').toUpperCase()]||String(value||'').toUpperCase());
const numeric = value => value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const validStat = new Set(['points','rebounds','assists','three_pointers_made','pra','points_rebounds','points_assists','rebounds_assists']);
const normalizedName = value => String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function mapNbaFrozenPregameModels(rows=[],players=[]) {
 const roster=new Map();
 for(const p of players){
  if(String(p.sport||'nba').toLowerCase()!=='nba'||!p.player_id)continue;
  const id=String(p.player_id),existing=roster.get(id);
  if(!existing)roster.set(id,p);
  else if(canonicalTeam(existing.team_key)!==canonicalTeam(p.team_key)||normalizedName(existing.player_name)!==normalizedName(p.player_name))roster.set(id,null);
 }
 const out=[];
 for(const r of rows){
  const id=String(r.player_id||''),game=String(r.game_id||'');
  const started=Date.parse(r.start_time),created=Date.parse(r.created_at),cutoff=Date.parse(r.feature_cutoff_timestamp);
  const projection=numeric(r.projection);
  const market=String(r.market_type||'').toLowerCase();
  const p=roster.get(id),team=canonicalTeam(r.team);
  const home=canonicalTeam(r.home_abbr),away=canonicalTeam(r.away_abbr);
  const opponent=team===home?away:team===away?home:null;
  if(!/^\d+$/.test(id)||!game||!p||!opponent||!validStat.has(market)||
   normalizedName(p.player_name)!==normalizedName(r.player_name)||
   canonicalTeam(p.team_key)!==team||projection==null||
   !Number.isFinite(started)||!Number.isFinite(created)||!Number.isFinite(cutoff)||
   created>=started||cutoff>=started||cutoff>created||
   !r.model_id||!r.model_version||
   ['OUT','IR','PUP','NFI','SUSPENDED'].includes(String(r.availability_status||'').toUpperCase()))continue;
  const stat=market==='pra'?'points_rebounds_assists':market;
  out.push({
   id:`nba:pregame:${game}:${id}:${stat}`,sport:'nba',canonicalEventId:game,
   canonicalPlayerId:`nba:espn:${id}`,player_name:r.player_name,
   team,opponent,start_time:r.start_time,canonical_market:stat,period:'full_game',
   line:null,provider:null,side:null,statSide:null,fbis_projection:projection,
   sigma:numeric(r.sigma),modelId:r.model_id,modelVersion:r.model_version,
   modelAsOf:r.feature_cutoff_timestamp,independent:true,marketInformed:false,
   modelStatus:'FROZEN_PREGAME_RESEARCH',historicalPregame:true,
   provenance:'NBA_DB_NBA_PLAYER_PROP_PROJECTIONS_PRETIP_CREATED',
   historyProvider:'espn',historyPlayerId:id,identityVerified:true,
   availabilityStatus:r.availability_status||'UNKNOWN',
   researchInputs:{projectedMinutes:numeric(r.projected_minutes)},
   validationStatus:'RESEARCH_NOT_WAGER_AUTHORIZED',marketAvailable:false,
   reasons:['PREGAME_SNAPSHOT_ONLY','THRESHOLD_CALIBRATION_REQUIRED'],
   canQualify:false,canAuthorizeWager:false
  });
 }
 return out;
}
export async function loadNbaFrozenPregameModels(env,{date,players=[]}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return {rows:[],diagnostics:['NBA_FREEZE_DATE_INVALID']};
 const owner=await resolveNbaResearchOwnerDb(env);
 if(!owner.ok||!owner.db?.prepare)return {rows:[],diagnostics:['NBA_FREEZE_OWNER_UNAVAILABLE']};
 try{
  const q=await owner.db.prepare(`
   WITH canonical AS (
    SELECT p.game_id,p.player_id,p.player_name,p.team,p.market_type,p.projection,p.sigma,
     p.projected_minutes,p.availability_status,p.model_id,p.model_version,
     p.feature_cutoff_timestamp,p.created_at,g.start AS start_time,g.home_abbr,g.away_abbr,
     ROW_NUMBER() OVER (PARTITION BY p.game_id,p.player_id,p.market_type
       ORDER BY julianday(p.created_at) DESC,p.id DESC) rn
    FROM nba_player_prop_projections p JOIN games g
     ON g.id=p.game_id AND g.sport='nba' AND g.date=?
    WHERE p.player_id IS NOT NULL AND p.projection IS NOT NULL
     AND julianday(p.created_at)<julianday(g.start)
     AND julianday(p.feature_cutoff_timestamp)<julianday(g.start)
     AND julianday(p.feature_cutoff_timestamp)<=julianday(p.created_at)
   )
   SELECT * FROM canonical WHERE rn=1 LIMIT 4500`).bind(date).all();
  return {rows:mapNbaFrozenPregameModels(q.results||[],players),
   diagnostics:[],source:'NBA_DB_PREGAME_PERSISTED',readOnly:true,canAuthorizeWager:false};
 }catch{return {rows:[],diagnostics:['NBA_FREEZE_READ_FAILED']};}
}
