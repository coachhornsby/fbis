/** CFB evidence preparation. No production mutation or wagering authority. */
import {sha256Hex} from './sha256Hex.js';
import {projectCfbFbisV2Production} from './cfbFbisV2.js';
export const CFB_FORWARD_VERSION='CFB-FORWARD-EVIDENCE-v1';
export const canonicalJson=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const clock=v=>{
 if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid zoned evidence clock');
 return Date.parse(v);
};
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
const totalKeys=new Set(['points_for','points_against','off_total_yards','off_pass_yards','off_passes','off_completions','off_rushes','off_rush_yards','off_first_downs_created','situ_third_down_attempts','situ_third_down_conversions','situ_fourth_down_attempts','situ_fourth_down_conversions','situ_penalties','situ_penalty_yards','to_turnovers','to_fumbles_lost','to_interceptions_thrown','passing_yards','pass_yards','pass_attempts','passing_attempts','completions','rushing_yards','rush_yards','rushing_attempts','rush_attempts','receiving_yards','rec_yards','receptions','targets','pass_td','rushing_td','receiving_td','interceptions','total_tackles','solo_tackles','sacks','tackles_for_loss','passes_defended','hurries','defensive_td','defensive_interceptions','interception_return_yards','interception_td','fumbles','fumbles_lost','fumbles_recovered','field_goals_made','field_goal_attempts','extra_points_made','extra_point_attempts','punts','punt_yards','kick_returns','kick_return_yards','punt_returns','punt_return_yards']);
export function summarizeCardMetrics(rows){
 const result={};
 for(const family of new Set(rows.flatMap(r=>Object.keys(r||{})))){
  result[family]={};
  for(const key of new Set(rows.flatMap(r=>Object.keys(r?.[family]||{})))){
   const values=rows.map(r=>r?.[family]?.[key]).filter(numeric);
   result[family][key]={games:values.length,total:values.length&&totalKeys.has(key)?values.reduce((a,b)=>a+b,0):null,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  }
 }
 const pairs=rows.map(r=>r.offense).filter(r=>numeric(r?.off_completions)&&numeric(r?.off_passes));
 const attempts=pairs.reduce((a,r)=>a+r.off_passes,0);
 result.passing={...result.passing,completion_rate:{games:pairs.length,mean:attempts?pairs.reduce((a,r)=>a+r.off_completions,0)/attempts:null,total:null}};
 return result;
}
export async function materializeResearchCards({teams,teamRows,playerRows,decisionAt,season=2026,quarantined=[],sourcePending=[]}){
 const cutoff=clock(decisionAt),teamIds=new Set(teams.map(t=>t.team_id)),byTeam=new Map(),seen=new Map();
 for(const r of teamRows){
  if(r.season!==season||!teamIds.has(r.team_id)||clock(r.observed_at)>cutoff||clock(r.game_at)>=cutoff)continue;
  const key=r.team_id+':'+r.game_id,old=seen.get(key);
  if(old&&clock(old.observed_at)===clock(r.observed_at)&&old.content_hash!==r.content_hash)throw Error('Ambiguous game correction');
  if(!old||clock(r.observed_at)>clock(old.observed_at))seen.set(key,r);
 }
 for(const r of seen.values())(byTeam.get(r.team_id)||byTeam.set(r.team_id,[]).get(r.team_id)).push(r);
 const cards=[];
 for(const team of teams){
  const games=(byTeam.get(team.team_id)||[]).sort((a,b)=>clock(a.game_at)-clock(b.game_at)||a.game_id.localeCompare(b.game_id));
  const gameIds=new Set(games.map(g=>g.game_id)),players={},playerVersions=new Map();
  for(const r of playerRows){
   if(r.team_id!==team.team_id||r.season!==season||!gameIds.has(r.game_id)||clock(r.observed_at)>cutoff)continue;
   if(quarantined.some(q=>q.team_id===r.team_id&&q.player_id===r.player_id))continue;
   const key=r.player_id+':'+r.game_id,old=playerVersions.get(key);
   if(old&&clock(old.observed_at)===clock(r.observed_at)&&old.content_hash!==r.content_hash)throw Error('Ambiguous player correction');
   if(!old||clock(r.observed_at)>clock(old.observed_at))playerVersions.set(key,r);
  }
  for(const r of [...playerVersions.values()].sort((a,b)=>clock(a.game_at)-clock(b.game_at)||a.game_id.localeCompare(b.game_id)))(players[r.player_id]||=[]).push(r);
  const record={wins:0,losses:0,ties:0,unavailable:0};
  for(const g of games){const score=JSON.parse(g.metrics_json).scoring;if(!numeric(score?.points_for)||!numeric(score?.points_against)){record.unavailable++;continue;}
   record.wins+=score.points_for>score.points_against;record.losses+=score.points_for<score.points_against;record.ties+=score.points_for===score.points_against;}
  const body={team_id:team.team_id,season,record,games:games.length,summary:summarizeCardMetrics(games.map(g=>JSON.parse(g.metrics_json))),
   rolling5:summarizeCardMetrics(games.slice(-5).map(g=>JSON.parse(g.metrics_json))),
   players:Object.fromEntries(Object.entries(players).map(([id,rs])=>[id,{games:rs.length,summary:summarizeCardMetrics(rs.map(r=>JSON.parse(r.metrics_json))),game_ids:rs.map(r=>r.game_id)}])),
   game_versions:games.map(g=>({id:g.id,game_id:g.game_id,game_at:g.game_at,content_hash:g.content_hash,observed_at:g.observed_at})),
   coverage:{quarantined_player_rows:quarantined.filter(r=>r.team_id===team.team_id).length,all_participation_verified:false,recent_final_games_pending:sourcePending.filter(r=>r.team_id===team.team_id).map(r=>r.game_id).sort(),opponent_adjusted:null},
   temporal_class:'RESEARCH_CARD_FROM_OBSERVED_POSTGAME_RECORDS',can_authorize_wager:false,can_influence_production:false};
  cards.push({...body,version:await sha256Hex(canonicalJson(body)),materialized_at:decisionAt,last_source_observation:games.map(g=>g.observed_at).sort((a,b)=>clock(a)-clock(b)).at(-1)||null});
 }
 return cards;
}

/** Recover captured feature values without converting legacy source claims into raw-source proof. */
export function recoverLegacyPregameCapture(row){
 let layers;try{layers=JSON.parse(row.layers_json);}catch{return {accepted:false,reason:'INVALID_LAYERS'};}
 const snap=layers?._snap,uncertainty=snap?.uncertainty;
 try{if(clock(row.frozen_at)>=clock(snap?.start))return {accepted:false,reason:'NOT_PREGAME'};}catch{return {accepted:false,reason:'MISSING_CLOCKS'};}
 if(!/^[a-f0-9]{40}$/.test(row.deployment_commit||'')||!uncertainty?.features)return {accepted:false,reason:'MISSING_INPUT_OR_CODE_EVIDENCE'};
 const priors={home:uncertainty.homePriorFrozen,away:uncertainty.awayPriorFrozen};
 if(!/^\d{1,12}$/.test(String(priors.home?.espnId||''))||!/^\d{1,12}$/.test(String(priors.away?.espnId||''))||String(priors.home.espnId)===String(priors.away.espnId))return {accepted:false,reason:'MISSING_CANONICAL_PARTICIPANTS'};
 for(const p of Object.values(priors)){try{if(clock(p.asOf)>clock(row.frozen_at))return {accepted:false,reason:'FUTURE_PRIOR_OBSERVATION'};}catch{return {accepted:false,reason:'MISSING_PRIOR_OBSERVATION'};}}
 return {accepted:true,id:row.id,game_id:row.game_id,kickoff_at:snap.start,feature_capture_at:row.frozen_at,code_sha:row.deployment_commit,
  team_ids:{home:'cfb:espn:'+priors.home.espnId,away:'cfb:espn:'+priors.away.espnId},captured_features:uncertainty.features,captured_priors:priors,
  captured_projection:{home:row.proj_home,away:row.proj_away,margin:row.proj_margin,total:row.proj_total,model_version:row.model_version},
  temporal_class:'LEGACY_PREGAME_CAPTURE_UPSTREAM_PROVENANCE_INCOMPLETE',upstream_source_observed_at:null,
  qualification_eligible:false,limitations:['Captured values are historical exposure evidence, not independently verified upstream facts','Original roster-derived starter claims remain unverified','No market/economic qualification']};
}

export async function buildForwardSnapshot({fixture,cards,priorByTeam={},receipts,decisionAt,codeSha}){
 const cutoff=clock(decisionAt);
 if(fixture.provider_start_time_tbd===true)throw Error('Kickoff time unconfirmed');
 if(fixture.status!=='STATUS_SCHEDULED'||clock(fixture.game_date)<=cutoff)throw Error('Not an upcoming scheduled game');
 if(!/^[a-f0-9]{40}$/.test(codeSha||''))throw Error('Code SHA required');
 if(!receipts?.length||receipts.some(r=>! /^[a-f0-9]{64}$/.test(r.sha256)||clock(r.observed_at)>cutoff))throw Error('Invalid source receipt');
 if(!/^\d{1,12}$/.test(String(fixture.home_id))||!/^\d{1,12}$/.test(String(fixture.away_id)))throw Error('Invalid canonical IDs');
 const ids={home:'cfb:espn:'+fixture.home_id,away:'cfb:espn:'+fixture.away_id};
 if(ids.home===ids.away)throw Error('Same participants');
 const side={};const versions={};const reasons=['MODEL_QUALIFICATION_DISABLED','PROSPECTIVE_ECONOMIC_COHORT_PENDING','KICKOFF_AND_VENUE_SOURCE_QUALIFICATION_PENDING'];
 for(const key of ['home','away']){
  const card=cards.find(c=>c.team_id===ids[key]);if(!card)throw Error('Canonical participant unavailable');
  if(clock(card.materialized_at)>cutoff||card.game_versions.some(g=>clock(g.observed_at)>cutoff||clock(g.game_at)>=cutoff))throw Error('Future card evidence');
  const prior=priorByTeam[ids[key]];
  if(prior&&clock(prior.observed_at)>cutoff)throw Error('Future prior evidence');
  side[key]={off:card.summary.scoring?.points_for?.mean??null,def:card.summary.scoring?.points_against?.mean??null,gamesPlayed:card.games,
   priorOff:prior?.off??null,priorDef:prior?.def??null,qbStarterKnown:false,qbName:null,classification:'FBS'};
  versions[key]=card.version;
  if(card.coverage.quarantined_player_rows)reasons.push('QUARANTINED_PLAYER_SOURCE');
  if(!card.games)reasons.push('TEAM_STATS_UNAVAILABLE');
  if(card.coverage.recent_final_games_pending?.length)reasons.push('FINAL_GAME_STATS_PENDING');
  if(!numeric(prior?.off)||!numeric(prior?.def))reasons.push('PRIOR_STRENGTH_UNAVAILABLE');
 }
 const modelInput={sport:'cfb',home:{id:fixture.home_id},away:{id:fixture.away_id},neutral:fixture.neutral_site===true||fixture.neutral_site==='true',cfbFbisV2Input:side,featureCutoffOk:true};
 const projection=projectCfbFbisV2Production(modelInput);
 const validProjection=projection.ok&&[projection.home,projection.away,projection.margin,projection.total,projection.pHomeWin,projection.sigmaMargin,projection.sigmaTotal].every(numeric)&&projection.pHomeWin>=0&&projection.pHomeWin<=1&&projection.sigmaMargin>0&&projection.sigmaTotal>0;
 if(!validProjection)reasons.push('VALID_PROJECTION_UNAVAILABLE');
 const body={version:CFB_FORWARD_VERSION,game_id:String(fixture.game_id),event_start_at:new Date(clock(fixture.game_date)).toISOString(),decision_at:new Date(cutoff).toISOString(),code_sha:codeSha,team_ids:ids,
  card_versions:versions,source_receipts:receipts,model_input:modelInput,model_version:projection.version||null,
  projection:validProjection?{home:projection.home,away:projection.away,margin:projection.margin,total:projection.total,p_home:projection.pHomeWin,p_away:1-projection.pHomeWin,sigma_margin:projection.sigmaMargin,sigma_total:projection.sigmaTotal}:null,
  projection_state:validProjection?'SHADOW_PROJECTED':'SOURCE_PENDING',projection_reason:projection.reason||null,
  projection_role:'FROZEN_INCUMBENT_COEFFICIENTS_ON_NEW_CARD_INPUT_SHADOW',observed_production_projection:null,
  temporal_class:'PROSPECTIVE_FEATURE_CAPTURE',upstream_stat_publication_times_verified:false,
  qualification_reasons:[...new Set(reasons)],can_qualify:false,can_authorize_wager:false,roi:null,clv:null,market_quote:null};
 return {...body,id:await sha256Hex(canonicalJson(body))};
}
