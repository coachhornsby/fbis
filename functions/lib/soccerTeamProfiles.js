import directory from '../../data/soccer-team-branding.js';
import { resolveSoccerBrand, soccerBrandKey } from './soccerTeamBranding.js';
import { SOCCER_RESEARCH_ROUTES } from './soccerResearchRouting.js';

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
