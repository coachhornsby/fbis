import directory from '../../data/soccer-team-branding.js';
import { resolveSoccerBrand, soccerBrandKey } from './soccerTeamBranding.js';
import { SOCCER_RESEARCH_ROUTES } from './soccerResearchRouting.js';
import { PITCHAPI_ADVANCED_ONLY_FIELDS } from './soccerPitchApiStore.js';
import { matchesPitchApiTeamName } from './soccerPitchApiIdentity.js';

export function soccerTeamDirectory() {
 const competitions=[...new Set(SOCCER_RESEARCH_ROUTES.map(r=>r.competition))];
 return competitions.map(league=>({league,teams:(directory.leagues[league]||[]).map(t=>({
  id:`soccer:espn:${t.id}`,espnId:String(t.id),name:t.displayName||t.name,sport:'soccer',league,
  ...resolveSoccerBrand({name:t.displayName||t.name},league),
 }))}));
}
export function summarizeSoccerTeamMatches(rows, team, asOf) {
 const cutoff=Date.parse(asOf), names=new Set([team.name,team.displayName,team.fullName].filter(Boolean).map(soccerBrandKey));
 const matches=rows.filter(r=>Date.parse(r.start_time||r.match_date)<cutoff && String(r.status).toUpperCase()==='FINAL')
  .flatMap(r=>{
   const home=String(r.home_team_id)===String(team.espnId)||names.has(soccerBrandKey(r.home_team_name));
   const away=String(r.away_team_id)===String(team.espnId)||names.has(soccerBrandKey(r.away_team_name));
   if(home===away)return [];
   const gf=home?r.home_score:r.away_score,ga=home?r.away_score:r.home_score;
   if(gf==null||ga==null||!Number.isFinite(Number(gf))||!Number.isFinite(Number(ga)))return [];
   return [{eventId:r.event_id,date:r.match_date,home,opponent:home?r.away_team_name:r.home_team_name,
    goalsFor:Number(gf),goalsAgainst:Number(ga),result:gf>ga?'W':gf<ga?'L':'D'}];
  }).sort((a,b)=>b.date.localeCompare(a.date));
 const n=matches.length;
 return {sampleSize:n,wins:matches.filter(r=>r.result==='W').length,draws:matches.filter(r=>r.result==='D').length,
  losses:matches.filter(r=>r.result==='L').length,
  goalsFor:n?matches.reduce((s,r)=>s+r.goalsFor,0):null,goalsAgainst:n?matches.reduce((s,r)=>s+r.goalsAgainst,0):null,
  goalsForPerMatch:n?matches.reduce((s,r)=>s+r.goalsFor,0)/n:null,
  goalsAgainstPerMatch:n?matches.reduce((s,r)=>s+r.goalsAgainst,0)/n:null,
  cleanSheets:n?matches.filter(r=>r.goalsAgainst===0).length:null,
  bttsRate:n?matches.filter(r=>r.goalsFor>0&&r.goalsAgainst>0).length/n:null,
  recentMatches:matches.slice(0,10),asOf,source:'FBIS canonical soccer_matches',
  scope:'Trailing 900 days of acquired final matches; not season standings'};
}

export const SOCCER_PROFILE_METRICS = Object.freeze([
 ['xg','Expected goals'],['npxg','Non-penalty xG'],['xgot','xG on target'],['xg_open_play','Open-play xG'],['xg_set_play','Set-play xG'],
 ['xg_per_shot','xG per shot'],['shots','Shots'],['sot','Shots on target'],['big_chances','Big chances'],
 ['ppda','PPDA'],['field_tilt','Field tilt'],['possession','Possession'],['final_third_entries','Final-third entries'],['box_entries','Box entries'],
 ['high_turnovers','High turnovers'],['counterpress_regains','Counterpress regains'],['ball_recovery_time','Ball recovery time'],
 ['xt','Expected threat'],['vaep','VAEP'],['xag','Expected assisted goals'],['progressive_passes','Progressive passes'],
 ['progressive_carries','Progressive carries'],['pass_accuracy','Pass accuracy'],['passes_into_box','Passes into box'],['key_passes','Key passes'],
 ['through_balls','Through balls'],['progressive_pass_distance','Progressive pass distance'],['carries_into_final_third','Carries into final third'],
 ['carries_into_box','Carries into box'],['avg_defensive_action_x','Defensive action height'],['buildup_attacks','Buildup attacks'],
 ['direct_attacks','Direct attacks'],['network_centralization','Passing network centralization'],['passes_per_sequence','Passes per sequence'],['direct_speed','Direct speed'],
]);
function metricNumber(value) {
 if(value==null||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
}
export function summarizeSoccerAdvanced(rows,team,asOf) {
 const names=[team.name,team.displayName,team.fullName].filter(Boolean),league=team.league||'';
 const cutoff=Date.parse(asOf);
 const samples=rows.filter(r=>String(r.status).toLowerCase()==='finished'&&Date.parse(r.start_time||r.match_date)<cutoff)
  .flatMap(r=>{
   // Stable PitchAPI IDs remain distinct from ESPN IDs. Aliases require a verified league.
   const h=names.some(name=>matchesPitchApiTeamName(r.home_team_name,name,league)),
     a=names.some(name=>matchesPitchApiTeamName(r.away_team_name,name,league));
   if(h===a)return [];
   return [{row:r,side:h?'home':'away',opponentSide:h?'away':'home'}];
  }).sort((a,b)=>b.row.match_date.localeCompare(a.row.match_date));
 const sourceValue=(sample,column)=>{
  // Legacy ingestion missed PitchAPI's singular big_chance key and coerced missing to 0.
  // Reconcile presentation from retained full-match source; never alter model inputs.
  if(column==='big_chances' && sample.row.raw_stats_json){
   try {
    const raw=JSON.parse(sample.row.raw_stats_json);
    const full=raw.periods?.find(p=>String(p.period).toLowerCase()==='all');
    const item=full?.groups?.flatMap(g=>g.items||[]).find(i=>i.key==='big_chance'||i.key==='big_chances');
    return metricNumber(item?.[sample.side]);
   }catch{return null;}
  }
  if(column==='big_chances')return null;
  if(PITCHAPI_ADVANCED_ONLY_FIELDS.includes(column) && sample.row.raw_advanced_json==null)return null;
  return metricNumber(sample.row[`${sample.side}_${column}`]);
 };
 const average=(list,column)=>{const values=list.map(s=>sourceValue(s,column)).filter(v=>v!=null);
  return {value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,sampleSize:values.length};};
 const metrics=SOCCER_PROFILE_METRICS.map(([key,label])=>({key,label,...average(samples,key),
  recent10:average(samples.slice(0,10),key),opponent:average(samples.map(s=>({...s,side:s.opponentSide})),key)}));
 const observed=samples.map(s=>s.row.source_observed_at).filter(Boolean).sort().at(-1)||null;
 return {source:'PitchAPI persisted match features',sourceObservedAt:observed,asOf,sampleSize:samples.length,
  advancedSourceMatches:samples.filter(s=>s.row.raw_advanced_json!=null).length,
  advancedSourceMissing:samples.filter(s=>s.row.raw_advanced_json==null).length,
  historyStart:samples.at(-1)?.row.match_date||null,historyEnd:samples[0]?.row.match_date||null,
  teamIds:[...new Set(samples.map(s=>String(s.row[`${s.side}_team_id`])).filter(v=>v&&v!=='undefined'))],
  reconciliation:{bigChancesSource:'Retained PitchAPI full-match raw stats (big_chance)',
   storedBigChancesMismatchCount:samples.filter(s=>sourceValue(s,'big_chances')!=null&&sourceValue(s,'big_chances')!==metricNumber(s.row[`${s.side}_big_chances`])).length},
  metrics,availableMetrics:metrics.filter(m=>m.sampleSize>0).length,
  identityPolicy:'Exact normalized name within competition; provider IDs never equated',
  scope:'Trailing 900 days of acquired finished matches; values are provider-reported',
  persistentStateUsedInProjection:false};
}
