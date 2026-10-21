/**
 * Research-only historical player enrichment for exchange-discovered Tennis cards.
 * Kalshi/Polymarket provide a listing, NEVER an independent model probability.
 * Only prematch Sackmann history feeds this *separate*, non-wagerable Elo estimate.
 */
import {tennisKey} from './tennisPlayerBank.js';

const source='SACKMANN_TENNIS_ABSTRACT_RESEARCH';
const acceptedTours=new Set(['atp','wta']);
const exchangeSources=new Set(['POLYMARKET_US_PUBLIC','KALSHI_PUBLIC_SHADOW']);
const isTime=v=>v&&Number.isFinite(Date.parse(v));
function history(playerRows,matchStart,now){
  const cutoff=Math.min(+now,Date.parse(matchStart));
  const day=new Date(Date.parse(matchStart)).toISOString().slice(0,10);
  const valid=playerRows.filter(r=>{
    if(r.source!==source||!r.source_license||!isTime(r.source_as_of)||!isTime(r.updated_at)||
      Date.parse(r.source_as_of)>cutoff||Date.parse(r.updated_at)>+now||
      !r.last_match_date||r.last_match_date>=day)return false;
    return true;
  }).flatMap(r=>{
    let p;try{p=JSON.parse(r.profile_json)}catch{return []}
    const surface=String(r.surface||'').toLowerCase(),n=Number(p.surfaceMatches);
    const elo=Number(p.surfaceElo?.[surface]);
    if(!['hard','clay','grass'].includes(surface)||!(n>0)||
      !Number.isFinite(elo)||elo<1000||elo>2400||
      tennisKey(p.name)!==tennisKey(r.player_name))return [];
    return [{surface,matches:n,elo,lastMatchDate:r.last_match_date,
      source:r.source,sourceAsOf:r.source_as_of,license:r.source_license}];
  });
  const matches=valid.reduce((sum,r)=>sum+r.matches,0);
  return {matches,lastMatchDate:valid.map(r=>r.lastMatchDate).sort().at(-1)||null,
    elo:matches>=10?valid.reduce((sum,r)=>sum+r.elo*r.matches,0)/matches:null,
    surfaces:valid.length,source:matches>0?source:null};
}
export function exchangeHistoricalEstimate(home,away){
  if(!(home?.matches>=10&&away?.matches>=10&&
    Number.isFinite(home.elo)&&Number.isFinite(away.elo)))return null;
  const p=1/(1+Math.pow(10,(away.elo-home.elo)/400));
  return {player1WinProb:Math.round(p*1000)/1000,
    player2WinProb:Math.round((1-p)*1000)/1000,
    source:'ALL_SURFACE_ELO_RESEARCH_ONLY',surface:null,
    observations:[home,away].map(x=>({elo:x.elo,matches:x.matches,
      lastMatchDate:x.lastMatchDate,source:x.source})),
    uncertainty:'SURFACE_UNVERIFIED; HISTORICAL_MATCH_DATA_MAY_BE_STALE',
    marketInformed:false,canQualify:false,canAuthorizeWager:false};
}
export async function enrichTennisExchangeHistoricalCards(db,games,{now=new Date()}={}){
  if(!db?.prepare||!Array.isArray(games))return {enriched:0,reviewed:0};
  // Bounded bulk lookup: avoid issuing four D1 reads per exchange card.
  const candidates=games.filter(g=>acceptedTours.has(String(g.tour||'').toLowerCase())&&
    exchangeSources.has(g.tennisProjection?.researchFixture?.source)&&
    g.tennisProjection?.eventIntegrity?.valid!==true&&
    g.tennisProjection?.researchEstimate==null&&
    g.tennisProjection?.player1WinProb==null);
  const rows=new Map();
  for(const tour of ['atp','wta']){
    const keys=[...new Set(candidates.filter(g=>g.tour===tour)
      .flatMap(g=>[tennisKey(g.home?.fullName||g.home?.name),
                   tennisKey(g.away?.fullName||g.away?.name)]).filter(Boolean))];
    for(let i=0;i<keys.length;i+=35){
      const batch=keys.slice(i,i+35);
      const sql=`SELECT tour,player_key,player_name,surface,profile_json,source,
        source_license,source_as_of,updated_at,last_match_date
        FROM tennis_player_profiles_current
        WHERE tour=? AND player_key IN (${batch.map(()=>'?').join(',')})`;
      const result=await db.prepare(sql).bind(tour,...batch).all();
      for(const row of result.results||[]){
        const k=tour+'|'+row.player_key;
        if(!rows.has(k))rows.set(k,[]);
        rows.get(k).push(row);
      }
    }
  }
  let enriched=0;
  for(const game of candidates){
    const t=game.tennisProjection;
    const start=game.start;
    // Kalshi expiration is not a match start; no pretended prematch inference.
    const verifiedClock=isTime(start)&&game.startTimeBasis!=='KALSHI_CONTRACT_EXPIRATION_ONLY';
    const names=[game.home?.fullName||game.home?.name,game.away?.fullName||game.away?.name];
    const historyPlayers=names.map(name=>verifiedClock?
      history(rows.get(game.tour+'|'+tennisKey(name))||[],start,now):
      {matches:0,elo:null,surfaces:0,lastMatchDate:null,source:null});
    t.historicalCoverage={source,matchedProfiles:historyPlayers.filter(p=>p.matches>0).length,
      players:historyPlayers.map((p,i)=>({name:names[i],matches:p.matches,
        surfaces:p.surfaces,lastMatchDate:p.lastMatchDate})),
      matchTimeVerified:verifiedClock,marketFree:true};
    const estimate=verifiedClock?exchangeHistoricalEstimate(...historyPlayers):null;
    if(estimate){t.researchEstimate=estimate;enriched++;}
  }
  return {enriched,reviewed:candidates.length,source,modelAuthorityChanged:false,
    canAuthorizeWager:false};
}
