import { soccerTeamDirectory } from './soccerTeamProfiles.js';
import { matchesPitchApiTeamName } from './soccerPitchApiIdentity.js';

// Source-only comparisons. Not power ratings and never inputs to a projection.
export const SOCCER_DESCRIPTIVE_RANK_METRICS = Object.freeze([
  {key:'pointsPerGame',label:'Points per match',higherBetter:true,minGames:8},
  {key:'goalsForPerGame',label:'Goals scored per match',higherBetter:true,minGames:8},
  {key:'goalsAgainstPerGame',label:'Goals allowed per match',higherBetter:false,minGames:8},
  {key:'goalDiffPerGame',label:'Goal difference per match',higherBetter:true,minGames:8},
  {key:'xgForPerGame',label:'xG per match',higherBetter:true,minGames:8,sampleKey:'xgGames'},
  {key:'xgAgainstPerGame',label:'xGA per match',higherBetter:false,minGames:8,sampleKey:'xgGames'},
  {key:'xgDiffPerGame',label:'xG differential per match',higherBetter:true,minGames:8,sampleKey:'xgGames'},
  {key:'ppda',label:'PPDA (lower is stronger pressing)',higherBetter:false,minGames:8,sampleKey:'advancedGames'},
  {key:'fieldTilt',label:'Field tilt',higherBetter:true,minGames:8,sampleKey:'advancedGames'},
  {key:'progressivePasses',label:'Progressive passes per match',higherBetter:true,minGames:8,sampleKey:'advancedGames'},
  {key:'xT',label:'Expected threat per match',higherBetter:true,minGames:8,sampleKey:'advancedGames'},
]);

export const SOCCER_DESCRIPTIVE_AGGREGATE_SQL = `
WITH team_games AS (
  SELECT home_team_id AS provider_id,home_team_name AS provider_name,
    home_score AS goals_for,away_score AS goals_against,
    home_xg AS xg_for,away_xg AS xg_against,
    CASE WHEN raw_advanced_json IS NOT NULL THEN home_ppda END AS ppda,
    CASE WHEN raw_advanced_json IS NOT NULL THEN home_field_tilt END AS field_tilt,
    CASE WHEN raw_advanced_json IS NOT NULL THEN home_progressive_passes END AS progressive_passes,
    CASE WHEN raw_advanced_json IS NOT NULL THEN home_xt END AS xt,
    CASE WHEN raw_advanced_json IS NOT NULL THEN 1 ELSE 0 END AS advanced_observed
  FROM soccer_pitchapi_match_features
  WHERE league_key=? AND match_date>=? AND match_date<? AND status='finished'
  UNION ALL
  SELECT away_team_id,away_team_name,away_score,home_score,
    away_xg,home_xg,
    CASE WHEN raw_advanced_json IS NOT NULL THEN away_ppda END,
    CASE WHEN raw_advanced_json IS NOT NULL THEN away_field_tilt END,
    CASE WHEN raw_advanced_json IS NOT NULL THEN away_progressive_passes END,
    CASE WHEN raw_advanced_json IS NOT NULL THEN away_xt END,
    CASE WHEN raw_advanced_json IS NOT NULL THEN 1 ELSE 0 END
  FROM soccer_pitchapi_match_features
  WHERE league_key=? AND match_date>=? AND match_date<? AND status='finished'
)
SELECT provider_id,MAX(provider_name) AS provider_name,COUNT(*) AS games,
 SUM(CASE WHEN goals_for>goals_against THEN 1 ELSE 0 END) AS wins,
 SUM(CASE WHEN goals_for=goals_against THEN 1 ELSE 0 END) AS draws,
 SUM(CASE WHEN goals_for<goals_against THEN 1 ELSE 0 END) AS losses,
 AVG(CASE WHEN goals_for IS NOT NULL AND goals_against IS NOT NULL
   THEN CASE WHEN goals_for>goals_against THEN 3 WHEN goals_for=goals_against THEN 1 ELSE 0 END END) AS points_per_game,
 AVG(goals_for) AS goals_for_per_game,AVG(goals_against) AS goals_against_per_game,
 AVG(goals_for-goals_against) AS goal_diff_per_game,
 COUNT(CASE WHEN xg_for IS NOT NULL AND xg_against IS NOT NULL THEN 1 END) AS xg_games,
 AVG(xg_for) AS xg_for_per_game,AVG(xg_against) AS xg_against_per_game,
 AVG(xg_for-xg_against) AS xg_diff_per_game,
 SUM(advanced_observed) AS advanced_games,
 AVG(ppda) AS ppda,AVG(field_tilt) AS field_tilt,
 AVG(progressive_passes) AS progressive_passes,AVG(xt) AS xt
FROM team_games GROUP BY provider_id
`;

const mapField={
 pointsPerGame:'points_per_game',goalsForPerGame:'goals_for_per_game',
 goalsAgainstPerGame:'goals_against_per_game',goalDiffPerGame:'goal_diff_per_game',
 xgForPerGame:'xg_for_per_game',xgAgainstPerGame:'xg_against_per_game',
 xgDiffPerGame:'xg_diff_per_game',ppda:'ppda',fieldTilt:'field_tilt',
 progressivePasses:'progressive_passes',xT:'xt',
};
const num=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function buildSoccerDescriptiveRanks(rows=[],league='') {
 const directory=soccerTeamDirectory().find(x=>x.league===league);
 if(!directory)return {ok:false,error:'unsupported-research-competition'};
 const teams=directory.teams.map(team=>{
   const matches=rows.filter(r=>matchesPitchApiTeamName(r.provider_name,team.name,league));
   if(matches.length!==1)return {id:team.id,name:team.name,logo:team.logo,color:team.color,
     providerTeamId:null,matches:0,missingReason:matches.length?'ambiguous-provider-team':'no-verified-provider-team',
     samples:{games:0,xgGames:0,advancedGames:0},values:{}};
   const r=matches[0];
   return {id:team.id,name:team.name,logo:team.logo,color:team.color,providerTeamId:r.provider_id,
     matches:num(r.games),record:{wins:num(r.wins),draws:num(r.draws),losses:num(r.losses)},
     samples:{games:num(r.games)||0,xgGames:num(r.xg_games)||0,advancedGames:num(r.advanced_games)||0},
     values:Object.fromEntries(Object.entries(mapField).map(([key,col])=>[key,num(r[col])])),
     missingReason:null};
 });
 const leaderboard=teams.map(team=>({...team,ranks:{}}));
 for(const spec of SOCCER_DESCRIPTIVE_RANK_METRICS){
   const sampleKey=spec.sampleKey||'games';
   const eligible=leaderboard.filter(t=>(t.samples[sampleKey]||0)>=spec.minGames && t.values[spec.key]!=null)
     .sort((a,b)=>spec.higherBetter?b.values[spec.key]-a.values[spec.key]:a.values[spec.key]-b.values[spec.key]);
   for(let i=0;i<eligible.length;i++){
     const value=eligible[i].values[spec.key];
     const prev=i>0&&eligible[i-1].values[spec.key]===value;
     eligible[i].ranks[spec.key]={rank:prev?eligible[i-1].ranks[spec.key].rank:i+1,eligibleTeams:eligible.length,
       value,sample:eligible[i].samples[sampleKey]};
   }
 }
 return {ok:true,league,teamCount:teams.length,
   methodology:'Descriptive ranks across current FBIS directory clubs with at least eight source-observed matches for each metric family. Historical rolling window, not official league standings or model power ratings.',
   source:'PitchAPI persisted final match scalars; raw advanced payload presence controls advanced metrics',
   metrics:SOCCER_DESCRIPTIVE_RANK_METRICS,teams:leaderboard,researchOnly:true,
   canInfluenceProjection:false,canQualify:false,canAuthorize:false};
}
