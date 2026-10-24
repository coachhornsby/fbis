/** Research serve-and-return player profile from validated TML observations.
 * tournament_date is a SOURCE DATE LABEL, not an independently verified
 * played-at timestamp. Do not claim an exact chronological last-five.
 */
const number=v=>Number.isFinite(Number(v))?Number(v):null;
const safeParse=s=>{try{return typeof s==='string'?JSON.parse(s):s}catch{return null}};
const ratio=(n,d)=>d>0?n/d:null;
export function deriveFreeTennisStatProfile(rows,{tour,sourcePlayerId}={}){
 if(!['atp','wta'].includes(tour)||!sourcePlayerId)throw Error('PLAYER_SOURCE_REQUIRED');
 const split=new Map();let matches=0,latestObserved=null,latestSourceDate=null;
 for(const row of rows){
  if(row.tour!==tour||![row.winner_source_id,row.loser_source_id].includes(sourcePlayerId))continue;
  const won=row.winner_source_id===sourcePlayerId;
  const player=safeParse(won?row.winner_stats_json:row.loser_stats_json);
  const opponent=safeParse(won?row.loser_stats_json:row.winner_stats_json);
  if(!player||!opponent)continue;
  const ps=number(player.svpt),os=number(opponent.svpt),
   first=number(player['1stIn']),firstWon=number(player['1stWon']),
   secondWon=number(player['2ndWon']),
   opponentFirstWon=number(opponent['1stWon']),opponentSecondWon=number(opponent['2ndWon']);
  if([ps,os,first,firstWon,secondWon,opponentFirstWon,opponentSecondWon].some(x=>x==null)||
   ps<=0||os<=0||first>ps||firstWon>first||secondWon>ps-first||
   opponentFirstWon+opponentSecondWon>os)continue;
  const surface=String(row.surface||'').toLowerCase();
  const old=split.get(surface)||{surface,matches:0,wins:0,servePoints:0,
   firstIn:0,firstWon:0,secondWon:0,returnPoints:0,returnWon:0,
   aces:0,doubleFaults:0};
  old.matches++;old.wins+=Number(won);old.servePoints+=ps;
  old.firstIn+=first;old.firstWon+=firstWon;old.secondWon+=secondWon;
  old.returnPoints+=os;old.returnWon+=os-opponentFirstWon-opponentSecondWon;
  old.aces+=number(player.ace)||0;old.doubleFaults+=number(player.df)||0;
  split.set(surface,old);matches++;
  if(!latestObserved||row.last_observed_at>latestObserved)latestObserved=row.last_observed_at;
  if(!latestSourceDate||row.source_date_label>latestSourceDate)latestSourceDate=row.source_date_label;
 }
 const sum={matches:0,wins:0,servePoints:0,firstIn:0,firstWon:0,secondWon:0,
  returnPoints:0,returnWon:0,aces:0,doubleFaults:0};
 const enriched=[...split.values()].map(v=>{
  for(const k of Object.keys(sum))sum[k]+=v[k];
  return {...v,winRate:ratio(v.wins,v.matches),firstServeInPct:ratio(v.firstIn,v.servePoints),
   firstServePointsWonPct:ratio(v.firstWon,v.firstIn),
   secondServePointsWonPct:ratio(v.secondWon,v.servePoints-v.firstIn),
   returnPointsWonPct:ratio(v.returnWon,v.returnPoints)};
 });
 return {tour,sourcePlayerId,matches,latestSourceDateLabel:latestSourceDate,
  latestObservedAt:latestObserved,surfaces:enriched,
  overall:{...sum,winRate:ratio(sum.wins,sum.matches),
    firstServeInPct:ratio(sum.firstIn,sum.servePoints),
    firstServePointsWonPct:ratio(sum.firstWon,sum.firstIn),
    secondServePointsWonPct:ratio(sum.secondWon,sum.servePoints-sum.firstIn),
    returnPointsWonPct:ratio(sum.returnWon,sum.returnPoints)},
  source:'TENNISMYLIFE',exactMatchDateVerified:false,
  attribution:'TennisMyLife match database',researchOnly:true,
  contractTradingAuthorized:false};
}
