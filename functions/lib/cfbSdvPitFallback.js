/**
 * Independent fallback for a CFBD 429: use only explicitly acquired, SHA-256
 * identified 2026 SportsDataverse FBS team summaries. Research/presentation
 * ONLY. Current season summaries are retrospective source state, so the
 * acquisition clock is prospective *from this run*, not a historical PIT proof.
 *
 * Attribution: SportsDataverse (CC BY 4.0), derived from ESPN game data.
 */
const number=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const validHash=value=>/^[a-f0-9]{64}$/i.test(String(value||""));
export function buildSdvPitResearchFeed(intelligence,{now=new Date().toISOString()}={}) {
 const observed=intelligence?.source?.observedAt;
 const at=Date.parse(String(observed||"")),clock=Date.parse(String(now||""));
 if(intelligence?.ok!==true||intelligence.season!==2026
   ||!Array.isArray(intelligence.teams)||!validHash(intelligence.source?.sha256)
   ||!Number.isFinite(at)||!Number.isFinite(clock)||at>clock+60000
   ||clock-at>60*60000)
   return {ok:false,reason:"source-integrity-or-receipt-window-unverified"};
 const byEspnId={},bySchool={};
 let absent=0;
 for(const team of intelligence.teams){
  const id=String(team?.espnId||"");
  if(!/^\d+$/.test(id)||team.teamId!==`cfb:espn:${id}`||number(team.games)<=0)continue;
  const stats=team.stats||{};
  const row={
   school:team.name,espnId:id,
   passEpa:number(stats.EPAplay_off_pass),rushEpa:number(stats.EPAplay_off_rush),
   passEpaAllowed:number(stats.EPAplay_def_pass),rushEpaAllowed:number(stats.EPAplay_def_rush),
   offensePpa:number(stats.adj_off_epa),defensePpa:number(stats.adj_def_epa),
   successRate:number(stats.success_off),successRateAllowed:number(stats.success_def),
   explosiveRate:number(stats.explosive_off),explosiveRateAllowed:number(stats.explosive_def),
   havocRate:number(stats.havoc_def),pointsPerOpportunity:number(stats.pts_per_opp_off),
   pointsPerOpportunityAllowed:number(stats.pts_per_opp_def),
   gamesPlayed:number(team.games),
   sourcePpa:"SDV_2026_SOURCE_OBSERVATION",sourceAdvanced:"SDV_2026_SOURCE_OBSERVATION",
  };
  if([row.passEpa,row.rushEpa,row.passEpaAllowed,row.rushEpaAllowed].some(v=>v===null)){
   absent++;continue;
  }
  if(byEspnId[id])return {ok:false,reason:"duplicate-canonical-team-id"};
  byEspnId[id]=row;
  // The caller attaches by exact ESPN ID; no name-only join on fallback.
 }
 if(!Object.keys(byEspnId).length)return {ok:false,reason:"no-four-direction-team-coverage"};
 return {ok:true,season:2026,byEspnId,bySchool,
  meta:{source:"SPORTSDATAVERSE_2026_FBS_TEAM_SUMMARIES",asOf:observed,
    sourceHash:intelligence.source.sha256,providerPublicationAt:null,
    historicalPitVerified:false,publicationTimeVerified:false,
    records:Object.keys(byEspnId).length,incompleteTeams:absent,
    attribution:"SportsDataverse (CC BY 4.0), derived from ESPN",
    sourceUrl:intelligence.source.url||null,sourceVersion:intelligence.version||null,
    configured:true,marketInformed:false,authority:"DISPLAY_RESEARCH_ONLY"}};
}
